import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context';

export const Navbar = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userInitial = user?.name ? user.name.trim()[0].toUpperCase() : 'U';

  return (
    <header className={`site-header ${isScrolled ? 'site-header-scrolled' : ''}`}>
      <div className="header-container">
        {/* Apple Inspired Brand Monogram */}
        <Link to="/" className="brand-logo" aria-label="HotelPro Home">
          <div className="brand-symbol">
            <span className="brand-apple-icon"></span>
          </div>
          <span className="brand-text">HotelPro</span>
          <span className="brand-subtext">Sanctuary</span>
        </Link>

        {/* Navigation Links */}
        <nav className="nav-links" aria-label="Main Navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            Overview
          </NavLink>

          <NavLink
            to="/rooms"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            Explore Sanctuaries
          </NavLink>

          {isAuthenticated ? (
            <>
              <NavLink
                to="/my-bookings"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                My Bookings
              </NavLink>

              {user?.role === 'admin' && (
                <NavLink
                  to="/admin/bookings"
                  className={({ isActive }) => (isActive ? 'nav-link active nav-link-admin' : 'nav-link nav-link-admin')}
                >
                  Admin Concierge
                </NavLink>
              )}

              <NavLink
                to="/profile"
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                Account
              </NavLink>

              <div className="nav-user-info">
                <div className="user-avatar-pill" title={user?.email}>
                  <span className="user-avatar-circle">{userInitial}</span>
                  <span className="user-display-name">{user?.name ? user.name.split(' ')[0] : 'User'}</span>
                  <span className={`role-badge role-${user?.role || 'customer'}`}>
                    {user?.role || 'customer'}
                  </span>
                </div>

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
                Book a Suite
              </NavLink>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
