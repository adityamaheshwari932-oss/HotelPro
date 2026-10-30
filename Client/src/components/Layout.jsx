import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import Navbar from './Navbar';

const CURRENT_YEAR = new Date().getFullYear();

export const Layout = () => {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="main-content" id="main-content">
        <Outlet />
      </main>
      <footer className="site-footer-apple">
        <div className="footer-grid-apple">
          <div className="footer-column-apple footer-brand-col">
            <div className="footer-brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="footer-apple-symbol" style={{ fontSize: '1.4rem', color: '#ffffff' }}></span>
              <span className="footer-brand-title" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff' }}>HotelPro</span>
            </div>
            <p className="footer-tagline-apple">
              Modern hotel booking and reservation platform. Engineered with 15-minute atomic holds, transparent pricing, and secure digital checkouts.
            </p>
          </div>

          <div className="footer-column-apple">
            <h4>Rooms &amp; Suites</h4>
            <ul>
              <li><Link to="/rooms">All Rooms</Link></li>
              <li><Link to="/rooms?roomType=suite">Luxury Suites</Link></li>
              <li><Link to="/rooms?roomType=double">Double Rooms</Link></li>
              <li><Link to="/rooms?roomType=single">Single Rooms</Link></li>
            </ul>
          </div>

          <div className="footer-column-apple">
            <h4>Account</h4>
            <ul>
              <li><Link to="/profile">Profile & Security</Link></li>
              <li><Link to="/my-bookings">Reservation History</Link></li>
              <li><Link to="/login">Sign In</Link></li>
              <li><Link to="/register">Create Account</Link></li>
            </ul>
          </div>

          <div className="footer-column-apple">
            <h4>Architecture</h4>
            <div className="footer-system-status">
              <div className="status-indicator-pill">
                <span className="status-live-dot"></span>
                <span className="status-label">HotelPro Core Online</span>
              </div>
              <p className="status-env-text" style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Environment: <code style={{ color: '#d1d1d6', background: 'rgba(255,255,255,0.08)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'}</code>
              </p>
              <p className="status-specs" style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-light)' }}>
                Atomic Locking: WiredTiger • Zero-Trust Security
              </p>
            </div>
          </div>
        </div>

        <div className="footer-bottom-apple">
          <p className="footer-copyright">
            Copyright &copy; {CURRENT_YEAR} HotelPro Inc. All rights reserved.
          </p>
          <div className="footer-legal-links" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Security Manifesto</span>
            <span>Zero-Trust Architecture</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
