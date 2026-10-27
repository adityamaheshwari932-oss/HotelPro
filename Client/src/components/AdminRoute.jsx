import React from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context';

/**
 * Route protection guard for Administrator-only sections.
 *
 * Enforces:
 * 1. User must be authenticated (otherwise redirects to /login with state).
 * 2. User must possess the 'admin' role (otherwise displays 403 Access Denied).
 */
export const AdminRoute = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading-container" role="status" aria-live="polite">
        <div className="auth-spinner" aria-hidden="true"></div>
        <p>Verifying administrative credentials...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role !== 'admin') {
    return (
      <div className="page-container">
        <div className="alert-error" role="alert" data-testid="admin-forbidden-alert">
          <span className="alert-icon">🚫</span>
          <div className="alert-body">
            <h3>403 — Administrative Access Required</h3>
            <p>
              Your account (<code>{user?.email}</code>) has the role <strong>{user?.role}</strong>,
              which does not have administrative privileges to view this management console.
            </p>
            <div className="alert-actions">
              <Link to="/" className="btn-secondary">
                Return to Home
              </Link>
              <Link to="/profile" className="btn-primary">
                View My Account
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return children;
};

export default AdminRoute;
