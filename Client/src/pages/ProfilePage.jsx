import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context';
import { getStoredToken, ApiError } from '../api/client';
import { updateProfile } from '../api/userApi';

export const ProfilePage = () => {
  const { user, validateSession, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  // Edit form state
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    phone: user?.phone || ''
  });
  const [formErrors, setFormErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');

  // Session verification state
  const [validationStatus, setValidationStatus] = useState(null);
  const [isValidating, setIsValidating] = useState(false);

  // Sync form data with user context
  const [prevUser, setPrevUser] = useState(user);
  if (user !== prevUser) {
    setPrevUser(user);
    setFormData({
      name: user?.name || '',
      phone: user?.phone || ''
    });
  }

  const validateForm = () => {
    const errors = {};
    const trimmedName = formData.name.trim();

    if (!trimmedName) {
      errors.name = 'Full name is required.';
    } else if (trimmedName.length < 2) {
      errors.name = 'Name must be at least 2 characters.';
    } else if (trimmedName.length > 100) {
      errors.name = 'Name cannot exceed 100 characters.';
    }

    if (formData.phone && formData.phone.trim().length > 30) {
      errors.phone = 'Phone number cannot exceed 30 characters.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (saveError) setSaveError('');
    if (saveSuccess) setSaveSuccess('');
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!validateForm() || isSaving) return;

    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');

    try {
      const response = await updateProfile({
        name: formData.name.trim(),
        phone: formData.phone.trim()
      });

      const updatedUser = response?.data?.user;
      if (updatedUser) {
        if (typeof updateUser === 'function') {
          updateUser(updatedUser);
        }
        setSaveSuccess('Your personal profile was updated successfully.');
        setIsEditing(false);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.message || 'Failed to update profile.');
      } else {
        setSaveError('Unable to connect to profile service. Please check your connection.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setFormData({
      name: user?.name || '',
      phone: user?.phone || ''
    });
    setFormErrors({});
    setSaveError('');
  };

  const handleValidateSession = async () => {
    setIsValidating(true);
    setValidationStatus(null);
    try {
      const isValid = await validateSession();
      setValidationStatus({
        success: isValid,
        message: isValid
          ? 'Session token authoritatively verified with backend (/api/auth/me).'
          : 'Session is no longer valid. You will be signed out.'
      });
      if (!isValid) {
        setTimeout(() => navigate('/login'), 1200);
      }
    } catch {
      setValidationStatus({
        success: false,
        message: 'Failed to verify session with backend.'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const hasToken = !!getStoredToken();

  return (
    <div className="profile-container" data-testid="profile-page">
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
            {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="profile-titles">
            <h2>{user?.name || 'Customer Account'}</h2>
            <p className="profile-email">{user?.email}</p>
          </div>
          <span className={`role-pill role-${user?.role || 'customer'}`} data-testid="user-role-badge">
            {user?.role?.toUpperCase() || 'CUSTOMER'}
          </span>
        </div>

        {/* Success Alert */}
        {saveSuccess && (
          <div className="alert-success" role="status" aria-live="polite" data-testid="profile-success-alert">
            <span className="alert-icon">✓</span>
            <div className="alert-body">
              <p>{saveSuccess}</p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {saveError && (
          <div className="alert-error" role="alert" data-testid="profile-error-alert">
            <span className="alert-icon">⚠️</span>
            <div className="alert-body">
              <p>{saveError}</p>
            </div>
          </div>
        )}

        {/* Session Verification Status */}
        {validationStatus && (
          <div
            className={validationStatus.success ? 'alert-success' : 'alert-error'}
            role="status"
          >
            <span>{validationStatus.success ? '✓' : '⚠️'}</span>
            <span>{validationStatus.message}</span>
          </div>
        )}

        {/* Quick Links Section */}
        <div className="profile-quick-nav">
          <Link to="/my-bookings" className="btn-secondary quick-nav-link" data-testid="my-bookings-link">
            📅 View My Booking History
          </Link>
          {user?.role === 'admin' && (
            <Link to="/admin/bookings" className="btn-secondary quick-nav-link" data-testid="admin-bookings-link">
              🛡️ Admin Booking & Payment Console
            </Link>
          )}
        </div>

        {/* Editable Profile Section vs. View Details */}
        {isEditing ? (
          <form onSubmit={handleSaveProfile} className="profile-edit-form" data-testid="profile-edit-form">
            <h3 className="section-title">Edit Personal Information</h3>

            <div className="form-group">
              <label htmlFor="name-input">Full Name *</label>
              <input
                id="name-input"
                name="name"
                type="text"
                className={`form-input ${formErrors.name ? 'input-error' : ''}`}
                value={formData.name}
                onChange={handleInputChange}
                disabled={isSaving}
                autoComplete="name"
              />
              {formErrors.name && <span className="error-text">{formErrors.name}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="email-read-only">Account Email (Read-Only)</label>
              <input
                id="email-read-only"
                type="email"
                className="form-input input-readonly"
                value={user?.email || ''}
                disabled
                readOnly
              />
              <span className="field-hint">
                🔒 Account email is permanently tied to authentication credentials and cannot be modified online.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="phone-input">Phone Contact Number</label>
              <input
                id="phone-input"
                name="phone"
                type="tel"
                className={`form-input ${formErrors.phone ? 'input-error' : ''}`}
                value={formData.phone}
                onChange={handleInputChange}
                disabled={isSaving}
                placeholder="+1 (555) 000-0000"
                autoComplete="tel"
              />
              {formErrors.phone && <span className="error-text">{formErrors.phone}</span>}
            </div>

            <div className="form-actions-row">
              <button
                type="submit"
                className="btn-primary"
                disabled={isSaving}
                data-testid="save-profile-btn"
              >
                {isSaving ? 'Saving Changes...' : 'Save Profile Changes'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-details-grid" data-testid="profile-details-grid">
            <div className="detail-item">
              <span className="detail-label">Account Name</span>
              <span className="detail-value">{user?.name}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Verified Email</span>
              <span className="detail-value">{user?.email}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Phone Contact</span>
              <span className="detail-value">{user?.phone || 'Not provided'}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Role Authorization</span>
              <span className="detail-value capitalize">{user?.role || 'customer'}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Account Status</span>
              <span className="detail-value status-active">{user?.status || 'active'}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Member Since</span>
              <span className="detail-value">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Active'}
              </span>
            </div>

            <div className="detail-item">
              <span className="detail-label">User Identifier</span>
              <span className="detail-value mono">{user?.id || user?._id || 'N/A'}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Session Token</span>
              <span className="detail-value">{hasToken ? '✓ Active in storage' : '✗ Missing'}</span>
            </div>
          </div>
        )}

        <div className="profile-actions">
          {!isEditing && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsEditing(true)}
              data-testid="edit-profile-btn"
            >
              ✏️ Edit Profile Information
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={handleValidateSession}
            disabled={isValidating}
          >
            {isValidating ? 'Validating Session...' : 'Re-verify Session with Server'}
          </button>

          <button type="button" className="btn-logout-full" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
