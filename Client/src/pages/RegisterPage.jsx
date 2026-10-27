import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context';
import { ApiError } from '../api/client';

export const RegisterPage = () => {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    phone: ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // If already authenticated, redirect to home
  if (isAuthenticated && !isSubmitting) {
    navigate('/', { replace: true });
  }

  const validate = () => {
    const errors = {};
    const nameTrimmed = formData.name.trim();
    const emailTrimmed = formData.email.trim();
    const password = formData.password;

    if (!nameTrimmed) {
      errors.name = 'Full name is required.';
    } else if (nameTrimmed.length < 2) {
      errors.name = 'Name must be at least 2 characters long.';
    }

    if (!emailTrimmed) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      errors.email = 'Please provide a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else {
      const passwordIssues = [];
      if (password.length < 8) passwordIssues.push('at least 8 characters');
      if (!/[A-Z]/.test(password)) passwordIssues.push('one uppercase letter');
      if (!/[a-z]/.test(password)) passwordIssues.push('one lowercase letter');
      if (!/[0-9]/.test(password)) passwordIssues.push('one number');
      if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
        passwordIssues.push('one special character');
      }

      if (passwordIssues.length > 0) {
        errors.password = `Password requires: ${passwordIssues.join(', ')}.`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (apiError) {
      setApiError('');
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
      // Register with autoLogin=true so the customer is immediately authenticated
      await register({
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
        phone: formData.phone.trim(),
        autoLogin: true
      });

      setSuccessMessage('Account created successfully! Redirecting...');
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 800);
    } catch (err) {
      setIsSubmitting(false);

      if (err instanceof ApiError) {
        // If backend returned field-level details
        if (err.details && typeof err.details === 'object') {
          setFormErrors((prev) => ({ ...prev, ...err.details }));
        }
        setApiError(err.message || 'Registration failed. Please check the form.');
      } else {
        setApiError('An unexpected network error occurred. Please try again.');
      }
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <h2>Create Customer Account</h2>
          <p>Join HotelPro to search rooms, manage reservations, and checkout securely</p>
        </div>

        {apiError && (
          <div className="alert-error" role="alert" aria-live="assertive">
            <span className="alert-icon">⚠️</span>
            <span className="alert-message">{apiError}</span>
          </div>
        )}

        {successMessage && (
          <div className="alert-success" role="status" aria-live="polite">
            <span className="alert-icon">✓</span>
            <span className="alert-message">{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="auth-form">
          <div className="form-group">
            <label htmlFor="reg-name">Full Name</label>
            <input
              id="reg-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              disabled={isSubmitting}
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g. Jane Doe"
              className={formErrors.name ? 'input-error' : ''}
              aria-invalid={!!formErrors.name}
              aria-describedby={formErrors.name ? 'reg-name-error' : undefined}
            />
            {formErrors.name && (
              <span id="reg-name-error" className="field-error-message">
                {formErrors.name}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="reg-email">Email Address</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isSubmitting}
              value={formData.email}
              onChange={handleChange}
              placeholder="e.g. jane.doe@example.com"
              className={formErrors.email ? 'input-error' : ''}
              aria-invalid={!!formErrors.email}
              aria-describedby={formErrors.email ? 'reg-email-error' : undefined}
            />
            {formErrors.email && (
              <span id="reg-email-error" className="field-error-message">
                {formErrors.email}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="reg-phone">Phone Number (Optional)</label>
            <input
              id="reg-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              disabled={isSubmitting}
              value={formData.phone}
              onChange={handleChange}
              placeholder="e.g. +1 555 123 4567"
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              disabled={isSubmitting}
              value={formData.password}
              onChange={handleChange}
              placeholder="Create a strong password"
              className={formErrors.password ? 'input-error' : ''}
              aria-invalid={!!formErrors.password}
              aria-describedby="reg-password-requirements reg-password-error"
            />
            <span id="reg-password-requirements" className="field-hint">
              Must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special symbol.
            </span>
            {formErrors.password && (
              <span id="reg-password-error" className="field-error-message">
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
                <span>Creating Account...</span>
              </span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="auth-card-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in instead
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
