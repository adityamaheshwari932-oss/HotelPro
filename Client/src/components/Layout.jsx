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
      <footer className="site-footer">
        <div className="footer-container">
          <div className="footer-top-row">
            <div className="footer-brand-col">
              <div className="footer-brand">
                <span className="footer-apple-symbol"></span>
                <span className="footer-brand-title">HotelPro Sanctuary</span>
              </div>
              <p className="footer-brand-desc">
                Architectural luxury hotel booking platform. Designed with 15-minute atomic reservation holds, dynamic price modeling, and hardware-grade tokenization.
              </p>
            </div>

            <div className="footer-nav-col">
              <h4>Sanctuaries</h4>
              <ul>
                <li><Link to="/rooms">All Suites</Link></li>
                <li><Link to="/rooms?roomType=suite">Penthouse Suites</Link></li>
                <li><Link to="/rooms?roomType=double">Skyline Doubles</Link></li>
                <li><Link to="/rooms?roomType=single">Minimalist Studios</Link></li>
              </ul>
            </div>

            <div className="footer-nav-col">
              <h4>Account</h4>
              <ul>
                <li><Link to="/profile">Profile & Security</Link></li>
                <li><Link to="/my-bookings">Reservation History</Link></li>
                <li><Link to="/login">Sign In</Link></li>
                <li><Link to="/register">Create Account</Link></li>
              </ul>
            </div>

            <div className="footer-nav-col">
              <h4>Architecture</h4>
              <div className="footer-system-status">
                <div className="status-indicator-pill">
                  <span className="status-live-dot"></span>
                  <span className="status-label">HotelPro Core Online</span>
                </div>
                <p className="status-env-text">
                  Environment: <code>{import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'}</code>
                </p>
                <p className="status-specs">
                  Atomic Locking: WiredTiger • PCI Compliant
                </p>
              </div>
            </div>
          </div>

          <div className="footer-bottom-row">
            <p className="footer-copyright">
              Copyright &copy; {CURRENT_YEAR} HotelPro Inc. All rights reserved. Designed in California.
            </p>
            <div className="footer-legal-links">
              <span>Privacy Policy</span>
              <span>Terms of Service</span>
              <span>Security Manifesto</span>
              <span>Zero-Trust Architecture</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
