import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context';

/**
 * Route protection wrapper component.
 *
 * SAFETY GUARANTEES:
 * 1. Prevents flashing protected content: When authentication state is still initializing
 *    (isLoading === true), renders a loading spinner rather than making premature redirect decisions.
 * 2. Preserves destination: When redirecting unauthenticated users to /login, passes the
 *    attempted location in state so the user can be returned upon successful authentication.
 */
export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading-container" role="status" aria-live="polite">
        <div className="auth-spinner" aria-hidden="true"></div>
        <p>Verifying authentication session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
