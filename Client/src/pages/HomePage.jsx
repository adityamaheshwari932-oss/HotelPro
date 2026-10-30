import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context';

export const HomePage = () => {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="home-container">
      {/*  APPLE KEYNOTE HERO SECTION */}
      <section className="hero-section">
        <div className="hero-badge-pill">
          <span className="hero-badge-dot"></span>
          <span className="hero-badge-text"> HotelPro OS • Ultra-Luxury Sanctuaries</span>
        </div>

        <h1 className="hero-title">
          Hospitality.
          <br />
          <span className="hero-gradient-text">Engineered for Tranquility.</span>
        </h1>

        <p className="hero-subtitle">
          An architectural breakthrough in luxury stays. Built with 15-minute atomic reservation holds, dynamic pricing, and hardware-grade data security. Precision-crafted from code to sanctuary.
        </p>

        <div className="hero-cta">
          {isAuthenticated ? (
            <div className="auth-welcome-card">
              <div className="welcome-avatar">
                <span>{user?.name ? user.name[0].toUpperCase() : 'U'}</span>
              </div>
              <div className="welcome-info">
                <p className="welcome-text">
                  Welcome back, <strong>{user?.name}</strong>
                </p>
                <p className="welcome-subtext">{user?.email}</p>
              </div>
              <div className="action-buttons">
                <Link to="/rooms" className="btn-primary">
                  <span>Explore Sanctuaries</span>
                  <span className="btn-arrow">→</span>
                </Link>
                <Link to="/my-bookings" className="btn-secondary">
                  My Bookings
                </Link>
                <Link to="/profile" className="btn-ghost">
                  Account Settings
                </Link>
              </div>
            </div>
          ) : (
            <div className="action-buttons hero-buttons-wrap">
              <Link to="/rooms" className="btn-primary">
                <span>Explore Sanctuaries</span>
                <span className="btn-arrow">→</span>
              </Link>
              <Link to="/login" className="btn-secondary">
                Sign In
              </Link>
              <Link to="/register" className="btn-ghost">
                Create Account
              </Link>
            </div>
          )}
        </div>

        {/*  FLOATING SHOWCASE CARD */}
        <div className="hero-showcase-wrapper">
          <div className="hero-showcase-glass-card">
            <div className="showcase-card-image-wrap">
              <img
                src="https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=85"
                alt="The Celestial Penthouse"
                className="showcase-image"
              />
              <div className="showcase-floating-badge">
                <span className="badge-pulse-dot"></span>
                <span>Room 501 • Penthouse Sanctuary</span>
              </div>
              <div className="showcase-price-tag">
                <span className="price-tag-value">$890</span>
                <span className="price-tag-period">/ night</span>
              </div>
            </div>
            <div className="showcase-card-details">
              <div className="showcase-meta">
                <span className="showcase-location">📍 Cupertino, California</span>
                <span className="showcase-rating">★★★★★ 5.0 Exceptional</span>
              </div>
              <h2 className="showcase-title">The Celestial Penthouse Sanctuary</h2>
              <p className="showcase-description">
                Private rooftop infinity plunge pool, 360-degree sunset vista, dedicated personal concierge, and private elevator entry.
              </p>
              <div className="showcase-amenities-row">
                <span className="amenity-chip">✨ Rooftop Pool</span>
                <span className="amenity-chip">🍸 Private Lounge</span>
                <span className="amenity-chip">🌿 Botanical Terrace</span>
                <span className="amenity-chip">⚡ 15m Instant Hold</span>
              </div>
              <div className="showcase-cta-row">
                <Link to="/rooms" className="btn-primary-small">
                  View Availability & Book
                </Link>
                <span className="showcase-guarantee">🛡️ Double-Booking Protected</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/*  APPLE BENTO GRID FEATURE SHOWCASE */}
      <section className="bento-section">
        <div className="section-header">
          <p className="section-eyebrow">FIRST-PRINCIPLES ARCHITECTURE</p>
          <h2 className="section-heading">Designed for Perfection. Built for Trust.</h2>
          <p className="section-subheading">
            Every layer of HotelPro is engineered with the exactness of precision hardware.
          </p>
        </div>

        <div className="bento-grid">
          {/* Bento Card 1: 15-Minute Hold Engine */}
          <div className="bento-card bento-card-large">
            <div className="bento-glow bento-glow-blue"></div>
            <div className="bento-icon-wrapper">⚡</div>
            <div className="bento-content">
              <span className="bento-pill">Autonomous Engine</span>
              <h3 className="bento-title">15-Minute Atomic Hold</h3>
              <p className="bento-desc">
                When you initiate a reservation, an exclusive atomic lock is placed on the physical room. Background workers monitor deadlines in real time to eliminate double-booking conflicts and checkout race conditions.
              </p>
              <div className="bento-code-snippet">
                <code>withRoomLock(roomId) → status: &quot;pending&quot; → holdExpiresAt: +15m</code>
              </div>
            </div>
          </div>

          {/* Bento Card 2: Security & Privacy */}
          <div className="bento-card">
            <div className="bento-glow bento-glow-gold"></div>
            <div className="bento-icon-wrapper">🛡️</div>
            <div className="bento-content">
              <span className="bento-pill">Privacy Core</span>
              <h3 className="bento-title">Hardware-Grade Security</h3>
              <p className="bento-desc">
                Strict zero-trust data protection. Raw card numbers, CVVs, and payment credentials are never stored or logged in our databases. Protected by bcrypt salted hashes and short-lived JWTs.
              </p>
            </div>
          </div>

          {/* Bento Card 3: Dynamic Pricing */}
          <div className="bento-card">
            <div className="bento-glow bento-glow-emerald"></div>
            <div className="bento-icon-wrapper">💎</div>
            <div className="bento-content">
              <span className="bento-pill">Absolute Transparency</span>
              <h3 className="bento-title">Dynamic Price Snapshots</h3>
              <p className="bento-desc">
                Server-authoritative pricing calculations with immutable snapshots. Transparent nightly breakdowns with zero hidden fees, fabricated resort charges, or surprise markups.
              </p>
            </div>
          </div>

          {/* Bento Card 4: Webhook Settlement */}
          <div className="bento-card bento-card-wide">
            <div className="bento-glow bento-glow-purple"></div>
            <div className="bento-icon-wrapper">💳</div>
            <div className="bento-content">
              <span className="bento-pill">Multi-Provider Settlement</span>
              <h3 className="bento-title">Instant Payment Reconciliation</h3>
              <p className="bento-desc">
                Support for authenticated mock simulation in local development and production Stripe PaymentIntents. Backed by cryptographic signature validation and idempotent webhook delivery.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/*  PHILOSOPHY / QUOTE SECTION */}
      <section className="philosophy-section">
        <div className="philosophy-card">
          <blockquote className="philosophy-quote">
            &ldquo;Technology is at its most powerful when it becomes invisible. HotelPro gives you space to simply breathe, rest, and exist in pure sanctuary.&rdquo;
          </blockquote>
          <p className="philosophy-author"> The HotelPro Design &amp; Engineering Team</p>
          <div className="philosophy-cta">
            <Link to="/rooms" className="btn-primary">
              Reserve Your Stay Today
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
