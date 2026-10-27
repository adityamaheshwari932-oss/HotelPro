/**
 * Centralized HTTP API Client for HotelPro Frontend.
 *
 * SAFETY & DESIGN GUARANTEES:
 * 1. Base URL: Reads from VITE_API_BASE_URL with safe local development fallback (http://localhost:5000/api).
 * 2. Token Handling: Automatically attaches Bearer token if present in storage or options.
 * 3. Robust Serialization: Automatically serializes JSON request payloads and parses JSON responses.
 * 4. Error Normalization: Preserves backend message and field-level validation errors into structured ApiError.
 * 5. Network & Timeout Resilience: AbortController with 15-second timeout, converts network drops into readable errors.
 * 6. Secret Redaction: Never logs passwords, tokens, or sensitive credentials.
 */

const envBaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) ||
  'http://localhost:5000/api';
const API_BASE_URL = envBaseUrl.replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 15000;
const TOKEN_STORAGE_KEY = 'hotelpro_token';

/**
 * Storage helpers for authentication token.
 * Note: LocalStorage is accessible by client JavaScript. In production environments,
 * protection against XSS vulnerabilities is essential to safeguard stored tokens.
 */
export const getStoredToken = () => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setStoredToken = (token) => {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Gracefully handle storage quotas or restricted iframe environments
  }
};

export const removeStoredToken = () => {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore
  }
};

/**
 * Structured API Error class representing an operational HTTP or network failure.
 */
export class ApiError extends Error {
  constructor(message, status = 500, details = null, raw = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.raw = raw;
  }
}

/**
 * Executes an HTTP request with automatic timeout, headers, and error normalization.
 *
 * @param {string} endpoint - Relative path (e.g. '/auth/login') or absolute URL
 * @param {object} [options] - Fetch options (method, body, headers, timeout, token)
 * @returns {Promise<any>}
 */
export const request = async (endpoint, options = {}) => {
  const {
    method = 'GET',
    body,
    headers = {},
    timeout = DEFAULT_TIMEOUT_MS,
    token: explicitToken,
    params,
    signal: externalSignal,
    ...customOptions
  } = options;

  // Resolve target URL and query parameters
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
    ? endpoint
    : `${API_BASE_URL}${normalizedEndpoint}`;

  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  // Build request headers
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json');
  }

  // Attach authentication token if available
  const activeToken = explicitToken !== undefined ? explicitToken : getStoredToken();
  if (activeToken && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', `Bearer ${activeToken}`);
  }

  // Prepare request body
  let requestBody = body;
  if (body !== undefined && body !== null) {
    if (typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
      if (!requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'application/json');
      }
      requestBody = JSON.stringify(body);
    }
  }

  // Timeout handling via AbortController with external signal support
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort('timeout');
  }, timeout);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
      ...customOptions
    });

    // Parse response content safely
    let responseData = null;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      try {
        responseData = await response.json();
      } catch {
        responseData = null;
      }
    } else {
      try {
        const textData = await response.text();
        responseData = textData ? { message: textData } : null;
      } catch {
        responseData = null;
      }
    }

    if (!response.ok) {
      const errorMessage =
        responseData?.message ||
        responseData?.error ||
        `Request failed with status ${response.status}`;
      const errorDetails = responseData?.details || null;

      throw new ApiError(errorMessage, response.status, errorDetails, responseData);
    }

    return responseData;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }

    if (err.name === 'AbortError' || controller.signal.aborted) {
      if (externalSignal && externalSignal.aborted) {
        throw new ApiError('Request was cancelled.', 0);
      }
      throw new ApiError(
        'Request timed out. Please check your network connection and try again.',
        408
      );
    }

    // Network disconnection / CORS / DNS failure
    throw new ApiError(
      'Unable to connect to the server. Please check your connection or try again later.',
      0
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Convenient REST verb helpers
 */
export const apiClient = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'POST', body }),
  patch: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),
  request
};

export default apiClient;
