import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context';
import { getStoredToken } from '../api/client';

export const ProfilePage = () => {
  const { user, validateSession, logout } = useAuth();
  const navigate = useNavigate();

  const [validationStatus, setValidationStatus] = useState(null);
  const [isValidating, setIsValidating] = useState(false);

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
    <div className="profile-container">
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
            {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="profile-titles">
            <h2>{user?.name || 'Customer Account'}</h2>
            <p className="profile-email">{user?.email}</p>
          </div>
          <span className={`role-pill role-${user?.role || 'customer'}`}>
            {user?.role?.toUpperCase() || 'CUSTOMER'}
          </span>
        </div>

        {validationStatus && (
          <div
            className={validationStatus.success ? 'alert-success' : 'alert-error'}
            role="status"
          >
            <span>{validationStatus.success ? '✓' : '⚠️'}</span>
            <span>{validationStatus.message}</span>
          </div>
        )}

        <div className="profile-details-grid">
          <div className="detail-item">
            <span className="detail-label">User Identifier</span>
            <span className="detail-value mono">{user?.id || user?._id || 'N/A'}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Role Authorization</span>
            <span className="detail-value">{user?.role || 'customer'}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Phone Contact</span>
            <span className="detail-value">{user?.phone || 'Not provided'}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Account Status</span>
            <span className="detail-value status-active">{user?.status || 'active'}</span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Account Created</span>
            <span className="detail-value">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Active'}
            </span>
          </div>

          <div className="detail-item">
            <span className="detail-label">Bearer Token Stored</span>
            <span className="detail-value">{hasToken ? '✓ Present in storage' : '✗ Missing'}</span>
          </div>
        </div>

        <div className="profile-actions">
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
