import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context';

export const Navbar = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const [prevPath, setPrevPath] = useState(location.pathname);
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname);
    setIsMobileMenuOpen(false);
  }

  // Lock body scroll and listen for Escape key when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setIsMobileMenuOpen(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleKeyDown);
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [isMobileMenuOpen]);

  const handleLogout = () => {
    setIsMobileMenuOpen(false);
    logout();
    navigate('/login');
  };

  const userInitial = user?.name ? user.name.trim()[0].toUpperCase() : 'U';
  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <header className={`site-header ${isScrolled ? 'site-header-scrolled' : ''} ${isAdminRoute ? 'site-header-admin' : ''}`} data-testid={isAdminRoute ? 'admin-navbar' : 'customer-navbar'}>
      <div className="header-container">
        {/* Apple Inspired Brand Monogram */}
        <Link to="/" className="brand-logo" aria-label="HotelPro Home" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="brand-symbol">
            <span className="brand-apple-icon"></span>
          </div>
          <span className="brand-text">HotelPro</span>
          {isAdminRoute ? (
            <span className="brand-subtext brand-subtext-admin">Admin Console</span>
          ) : (
            <span className="brand-subtext">Reservations</span>
          )}
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="nav-links desktop-nav" aria-label="Main Navigation">
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
                  to="/admin"
                  className={({ isActive }) => (isActive ? 'nav-link active nav-link-admin' : 'nav-link nav-link-admin')}
                  data-testid="nav-link-admin-dashboard"
                >
                  Admin Dashboard
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

        {/* Mobile Hamburger Toggle Button */}
        <button
          type="button"
          className="navbar-hamburger"
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-label={isMobileMenuOpen ? 'Close main navigation menu' : 'Open main navigation menu'}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-nav-drawer"
        >
          <span className={`hamburger-bar ${isMobileMenuOpen ? 'bar-open-1' : ''}`}></span>
          <span className={`hamburger-bar ${isMobileMenuOpen ? 'bar-open-2' : ''}`}></span>
          <span className={`hamburger-bar ${isMobileMenuOpen ? 'bar-open-3' : ''}`}></span>
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div
          className="mobile-nav-overlay"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Sliding Navigation Drawer */}
      <nav
        id="mobile-nav-drawer"
        className={`mobile-nav-drawer ${isMobileMenuOpen ? 'drawer-open' : ''}`}
        aria-label="Mobile Navigation"
        aria-hidden={!isMobileMenuOpen}
      >
        <div className="mobile-drawer-header">
          <div className="brand-logo">
            <span className="brand-apple-icon"></span>
            <span className="brand-text">HotelPro</span>
          </div>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {isAuthenticated && (
          <div className="mobile-user-profile-card">
            <div className="mobile-user-avatar">{userInitial}</div>
            <div className="mobile-user-meta">
              <span className="mobile-user-name">{user?.name || 'Guest'}</span>
              <span className="mobile-user-email">{user?.email}</span>
              <span className={`role-badge role-${user?.role || 'customer'}`}>
                {user?.role || 'customer'}
              </span>
            </div>
          </div>
        )}

        <div className="mobile-nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <span>Overview</span>
            <span className="mobile-link-arrow">→</span>
          </NavLink>

          <NavLink
            to="/rooms"
            className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <span>Explore Sanctuaries</span>
            <span className="mobile-link-arrow">→</span>
          </NavLink>

          {isAuthenticated ? (
            <>
              <NavLink
                to="/my-bookings"
                className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span>My Bookings</span>
                <span className="mobile-link-arrow">→</span>
              </NavLink>

              {user?.role === 'admin' && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) => (isActive ? 'mobile-nav-link active mobile-link-admin' : 'mobile-nav-link mobile-link-admin')}
                  onClick={() => setIsMobileMenuOpen(false)}
                  data-testid="mobile-link-admin-dashboard"
                >
                  <span>🛡️ Admin Dashboard</span>
                  <span className="mobile-link-arrow">→</span>
                </NavLink>
              )}

              <NavLink
                to="/profile"
                className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span>Account &amp; Security</span>
                <span className="mobile-link-arrow">→</span>
              </NavLink>

              <button
                type="button"
                className="mobile-btn-logout"
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </>
          ) : (
            <div className="mobile-auth-actions">
              <NavLink
                to="/login"
                className="btn-secondary"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Sign In
              </NavLink>
              <NavLink
                to="/register"
                className="btn-primary"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Book a Suite
              </NavLink>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
