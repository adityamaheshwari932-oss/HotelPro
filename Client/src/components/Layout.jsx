import React from 'react';
import { Outlet } from 'react-router-dom';
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
          <p className="footer-copyright">
            &copy; {CURRENT_YEAR} HotelPro Management System. All rights reserved.
          </p>
          <p className="footer-status">
            API Environment: <code>{import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'}</code>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
