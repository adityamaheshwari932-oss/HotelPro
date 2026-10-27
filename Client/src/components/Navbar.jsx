import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context';

export const Navbar = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="site-header">
      <div className="header-container">
        <Link to="/" className="brand-logo">
          <span className="brand-icon">🏨</span>
          <span className="brand-text">HotelPro</span>
        </Link>

        <nav className="nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            Home
          </NavLink>

          <NavLink
            to="/rooms"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            Explore Rooms
          </NavLink>

          {isAuthenticated ? (
            <>
              <NavLink
                to="/profile"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                My Account
              </NavLink>

              <div className="nav-user-info">
                <span className="user-greeting">
                  Hello, <strong>{user?.name}</strong>
                </span>
                <span className={`role-badge role-${user?.role || 'customer'}`}>
                  {user?.role || 'customer'}
                </span>
                <button
                  type="button"
                  className="btn-logout"
                  onClick={handleLogout}
                  aria-label="Log out of HotelPro"
                >
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <div className="nav-auth-actions">
              <NavLink
                to="/login"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Sign In
              </NavLink>
              <NavLink to="/register" className="btn-primary-small">
                Create Account
              </NavLink>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
