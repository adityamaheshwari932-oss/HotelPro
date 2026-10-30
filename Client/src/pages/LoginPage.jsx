import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context';
import { ApiError } from '../api/client';

export const LoginPage = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({
    email: location.state?.registeredEmail || '',
    password: ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState(location.state?.message || '');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Preserve complete return destination including query parameters
  const fromState = location.state?.from;
  const from = fromState
    ? (typeof fromState === 'string'
        ? fromState
        : `${fromState.pathname || '/'}${fromState.search || ''}`)
    : '/';

  // If already authenticated, redirect to destination
  useEffect(() => {
    if (isAuthenticated && !isSubmitting) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isSubmitting, from, navigate]);

  const validate = () => {
    const errors = {};
    const emailTrimmed = formData.email.trim();

    if (!emailTrimmed) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      errors.email = 'Please provide a valid email address.';
    }

    if (!formData.password) {
      errors.password = 'Password is required.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear field-level error as user edits
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (apiError) {
      setApiError('');
    }
    if (successMessage) {
      setSuccessMessage('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await login({
        email: formData.email.trim(),
        password: formData.password
      });

      // Redirect to the originally intended route or home
      navigate(from, { replace: true });
    } catch (err) {
      setIsSubmitting(false);
      if (err instanceof ApiError) {
        setApiError(err.message || 'Login failed. Please check your credentials.');
      } else {
        setApiError('An unexpected network error occurred. Please try again.');
      }
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <h2>Welcome Back</h2>
          <p>Sign in to your HotelPro account to manage reservations</p>
        </div>

        {successMessage && (
          <div className="alert-success" role="status" aria-live="polite">
            <span className="alert-icon">✓</span>
            <span className="alert-message">{successMessage}</span>
          </div>
        )}

        {apiError && (
          <div className="alert-error" role="alert" aria-live="assertive">
            <span className="alert-icon">⚠️</span>
            <span className="alert-message">{apiError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="auth-form">
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isSubmitting}
              value={formData.email}
              onChange={handleChange}
              placeholder="e.g. guest@example.com"
              className={formErrors.email ? 'input-error' : ''}
              aria-invalid={!!formErrors.email}
              aria-describedby={formErrors.email ? 'login-email-error' : undefined}
            />
            {formErrors.email && (
              <span id="login-email-error" className="field-error-message">
                {formErrors.email}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div className="password-input-wrapper">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={isSubmitting}
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter your password"
                className={formErrors.password ? 'input-error' : ''}
                aria-invalid={!!formErrors.password}
                aria-describedby={formErrors.password ? 'login-password-error' : undefined}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            {formErrors.password && (
              <span id="login-password-error" className="field-error-message">
                {formErrors.password}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <span className="btn-loading-content">
                <span className="spinner-small" aria-hidden="true"></span>
                <span>Signing In...</span>
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="auth-card-footer">
          <p>
            Do not have an account yet?{' '}
            <Link to="/register" className="auth-link">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
