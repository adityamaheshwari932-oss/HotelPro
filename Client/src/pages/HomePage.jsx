import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context';

export const HomePage = () => {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="home-container">
      <section className="hero-section">
        <h1 className="hero-title">Experience Hospitality Reimagined</h1>
        <p className="hero-subtitle">
          Welcome to HotelPro — a modern hotel reservation and management platform built with high-concurrency payment protection, real-time availability, and secure authentication.
        </p>

        <div className="hero-cta">
          {isAuthenticated ? (
            <div className="auth-welcome-card">
              <p className="welcome-text">
                Signed in as <strong>{user?.name}</strong> ({user?.email})
              </p>
              <div className="action-buttons">
                <Link to="/rooms" className="btn-primary">
                  🔍 Search & Browse Rooms
                </Link>
                <Link to="/profile" className="btn-secondary">
                  My Account Profile
                </Link>
              </div>
            </div>
          ) : (
            <div className="action-buttons">
              <Link to="/rooms" className="btn-primary">
                🔍 Find Available Rooms
              </Link>
              <Link to="/login" className="btn-secondary">
                Sign In to Your Account
              </Link>
              <Link to="/register" className="btn-secondary">
                Register Customer
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">🛡️</div>
          <h3>Secure Authentication</h3>
          <p>
            Role-based authorization with bcrypt password hashing and short-lived JWT credentials verified against backend security policies.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <h3>Real-Time Booking Holds</h3>
          <p>
            15-minute hold guarantees with distributed room locking preventing double-bookings and race conditions.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">💳</div>
          <h3>Multi-Provider Payments</h3>
          <p>
            Provider abstraction layer supporting mock gateway simulations and real Stripe PaymentIntents with webhook idempotency.
          </p>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
