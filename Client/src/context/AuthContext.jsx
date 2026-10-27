import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, getStoredToken, setStoredToken, removeStoredToken, ApiError } from '../api/client';
import { AuthContext } from './authContextDef';

/**
 * Authentication Context Provider
 *
 * Exposes:
 * - user: { id, name, email, role, phone, status, createdAt } | null
 * - isAuthenticated: boolean
 * - isLoading: boolean
 * - login: async ({ email, password }) => data
 * - register: async ({ name, email, password, phone, autoLogin }) => data
 * - logout: () => void
 * - validateSession: async () => boolean
 *
 * TOKEN STORAGE & SECURITY ARCHITECTURE:
 * Tokens are stored in browser localStorage for session persistence across page refreshes.
 * IMPORTANT SECURITY NOTE: JavaScript-accessible storage (localStorage / sessionStorage) is
 * susceptible to exfiltration if an application suffers a Cross-Site Scripting (XSS) vulnerability.
 * In production architectures with strict compliance needs, HttpOnly, SameSite cookies managed
 * by backend endpoints provide enhanced defense against script-based token theft.
 */

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Active validation request tracker to prevent race conditions during logout/remount
  const sessionCheckIdRef = useRef(0);

  /**
   * Authoritatively restores and validates the active session against the backend.
   */
  const validateSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return false;
    }

    const currentCheckId = ++sessionCheckIdRef.current;

    try {
      const response = await apiClient.get('/auth/me');

      // Discard stale response if a newer check or logout was initiated
      if (currentCheckId !== sessionCheckIdRef.current) {
        return false;
      }

      if (response?.data?.user) {
        setUser(response.data.user);
        setIsLoading(false);
        return true;
      }

      // If user data missing, clear unauthoritative session
      removeStoredToken();
      setUser(null);
      setIsLoading(false);
      return false;
    } catch (err) {
      if (currentCheckId !== sessionCheckIdRef.current) {
        return false;
      }

      // If token expired (401) or rejected (403), invalidate local storage
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        removeStoredToken();
      }

      setUser(null);
      setIsLoading(false);
      return false;
    }
  }, []);

  // Restore session once on component mount
  useEffect(() => {
    let isCancelled = false;
    const runValidation = async () => {
      if (!isCancelled) {
        await validateSession();
      }
    };
    runValidation();

    return () => {
      isCancelled = true;
    };
  }, [validateSession]);

  /**
   * Authenticates user with credentials and stores JWT token upon success.
   *
   * @param {object} credentials - { email, password }
   * @returns {Promise<object>} Backend response data { token, user }
   */
  const login = useCallback(async ({ email, password }) => {
    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { token, user: authenticatedUser } = response.data;

      if (!token || !authenticatedUser) {
        throw new ApiError('Malformed authentication response from server', 500);
      }

      setStoredToken(token);
      setUser(authenticatedUser);
      setIsLoading(false);
      return response.data;
    } catch (err) {
      setIsLoading(false);
      throw err;
    }
  }, []);

  /**
   * Registers a new customer account.
   * If autoLogin is true, immediately logs the new user in using the same credentials.
   *
   * @param {object} registrationData - { name, email, password, phone, autoLogin }
   * @returns {Promise<object>} Created user data or login data if autoLogin is true
   */
  const register = useCallback(async ({ name, email, password, phone, autoLogin = false }) => {
    setIsLoading(true);
    try {
      const registerRes = await apiClient.post('/auth/register', {
        name,
        email,
        password,
        phone
      });

      if (autoLogin) {
        const loginData = await login({ email, password });
        return loginData;
      }

      setIsLoading(false);
      return registerRes.data;
    } catch (err) {
      setIsLoading(false);
      throw err;
    }
  }, [login]);

  /**
   * Clears the current session and purges the stored authentication token.
   */
  const logout = useCallback(() => {
    // Invalidate any in-flight session checks
    sessionCheckIdRef.current++;
    removeStoredToken();
    setUser(null);
    setIsLoading(false);
  }, []);

  /**
   * Updates the in-memory authenticated user state following a successful profile update.
   */
  const updateUser = useCallback((updatedUserData) => {
    if (!updatedUserData) return;
    setUser((prev) => ({
      ...prev,
      ...updatedUserData
    }));
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    validateSession,
    updateUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};


export default AuthProvider;
