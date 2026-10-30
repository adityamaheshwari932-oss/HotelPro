import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context';
import { apiClient } from '../api/client';
import { formatRoomType, formatPrice } from '../utils/roomFormatters';

export const HomePage = () => {
  const { user, isAuthenticated } = useAuth();

  const [rooms, setRooms] = useState([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [roomsError, setRoomsError] = useState(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Timer reference for auto-rotation
  const timerRef = useRef(null);

  // Fetch rooms from backend API
  useEffect(() => {
    let isCancelled = false;

    const fetchRooms = async () => {
      try {
        setIsLoadingRooms(true);
        setRoomsError(null);
        const res = await apiClient.get('/rooms');
        if (!isCancelled) {
          const fetchedRooms = res?.data?.rooms;
          if (Array.isArray(fetchedRooms)) {
            setRooms(fetchedRooms);
          } else {
            setRooms([]);
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load room inventory:', err.message);
          setRooms([]);
          setRoomsError('Live room inventory is currently unavailable. Please explore our rooms directory directly.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingRooms(false);
        }
      }
    };

    fetchRooms();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Auto-advance carousel slide every 5 seconds when not paused and multiple slides exist
  useEffect(() => {
    if (isPaused || rooms.length <= 1) return;

    timerRef.current = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % rooms.length);
    }, 5000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [rooms.length, isPaused]);

  const handlePrevSlide = () => {
    if (rooms.length === 0) return;
    setActiveSlide((prev) => (prev - 1 + rooms.length) % rooms.length);
  };

  const handleNextSlide = () => {
    if (rooms.length === 0) return;
    setActiveSlide((prev) => (prev + 1) % rooms.length);
  };

  const currentRoom = rooms[activeSlide] || null;
  const currentPhoto =
    currentRoom &&
    ((Array.isArray(currentRoom.photos) && currentRoom.photos[0]) ||
      (typeof currentRoom.photos === 'string' ? currentRoom.photos.split(' ')[0] : null));

  return (
    <div className="home-container">
      {/*  APPLE KEYNOTE HERO SECTION */}
      <section className="hero-section">
        <div className="hero-badge-pill">
          <span className="hero-badge-dot"></span>
          <span className="hero-badge-text"> HotelPro • Modern Hotel Booking Platform</span>
        </div>

        <h1 className="hero-title">
          Hospitality.
          <br />
          <span className="hero-gradient-text">Engineered for Tranquility.</span>
        </h1>

        <p className="hero-subtitle">
          Experience effortless hotel reservations. Built with 15-minute atomic holds, date-specific dynamic pricing, and secure digital checkouts.
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
                  <span>Explore Rooms</span>
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
                <span>Explore Rooms</span>
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

        {/*  INTERACTIVE MULTI-SLIDE CAROUSEL */}
        <div
          className="hero-showcase-wrapper carousel-wrapper"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          aria-roledescription="carousel"
          aria-label="HotelPro Room Showcase Carousel"
        >
          {isLoadingRooms ? (
            <div className="hero-showcase-glass-card carousel-loading-card">
              <div className="carousel-skeleton-media"></div>
              <div className="showcase-card-details">
                <div className="skeleton-line" style={{ width: '40%', height: '24px', marginBottom: '1rem' }}></div>
                <div className="skeleton-line" style={{ width: '80%', height: '16px', marginBottom: '0.5rem' }}></div>
                <div className="skeleton-line" style={{ width: '60%', height: '16px' }}></div>
              </div>
            </div>
          ) : roomsError ? (
            <div className="hero-showcase-glass-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
              <h2 style={{ fontSize: '1.5rem', color: '#ffffff', marginBottom: '0.75rem' }}>
                Room Showcase Temporarily Unavailable
              </h2>
              <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 1.75rem' }}>
                {roomsError}
              </p>
              <Link to="/rooms" className="btn-primary-small">
                Browse Rooms Directory
              </Link>
            </div>
          ) : rooms.length === 0 ? (
            <div className="hero-showcase-glass-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🏨</div>
              <h2 style={{ fontSize: '1.5rem', color: '#ffffff', marginBottom: '0.75rem' }}>
                No Rooms Currently Available
              </h2>
              <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 1.75rem' }}>
                There are no active room listings in the system at this time. Please check back later.
              </p>
              <Link to="/rooms" className="btn-primary-small">
                View Rooms Page
              </Link>
            </div>
          ) : currentRoom ? (
            <div className="hero-showcase-glass-card carousel-card">
              {/* Media container */}
              <div className="showcase-card-image-wrap">
                {currentPhoto ? (
                  <img
                    src={currentPhoto}
                    alt={`Room ${currentRoom.roomNumber} - ${formatRoomType(currentRoom.roomType)}`}
                    className="showcase-image"
                    key={currentRoom._id}
                  />
                ) : (
                  <div className="showcase-image-fallback" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1c1c1e', color: 'var(--text-muted)' }}>
                    <span>Photo unavailable</span>
                  </div>
                )}
                <div className="showcase-floating-badge">
                  <span className="badge-pulse-dot"></span>
                  <span>Room {currentRoom.roomNumber} • {formatRoomType(currentRoom.roomType)}</span>
                </div>
                <div className="showcase-price-tag">
                  <span className="price-tag-value">{formatPrice(currentRoom.basePrice)}</span>
                  <span className="price-tag-period">/ night</span>
                </div>

                {/* Carousel Previous / Next Navigation Arrows */}
                {rooms.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="carousel-btn carousel-btn-prev"
                      onClick={handlePrevSlide}
                      aria-label="Previous room slide"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="carousel-btn carousel-btn-next"
                      onClick={handleNextSlide}
                      aria-label="Next room slide"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>

              {/* Details container */}
              <div className="showcase-card-details">
                <div className="showcase-meta">
                  <span className="showcase-location">
                    {currentRoom.hotel?.name || 'HotelPro Property'}
                  </span>
                  <span className="showcase-rating">Capacity: {currentRoom.capacity} {currentRoom.capacity === 1 ? 'Guest' : 'Guests'}</span>
                </div>
                <h2 className="showcase-title">
                  Room {currentRoom.roomNumber} — {formatRoomType(currentRoom.roomType)}
                </h2>
                <p className="showcase-description">
                  {currentRoom.description || 'Comfortable and well-appointed room tailored for a restful stay.'}
                </p>
                <div className="showcase-amenities-row">
                  <span className="amenity-chip">👥 Up to {currentRoom.capacity || 2} {currentRoom.capacity === 1 ? 'Guest' : 'Guests'}</span>
                  <span className="amenity-chip">⚡ 15m Reservation Hold</span>
                  <span className="amenity-chip">✓ Dynamic Pricing Breakdown</span>
                  <span className="amenity-chip">🛡️ Double-Booking Protected</span>
                </div>
                <div className="showcase-cta-row">
                  <Link
                    to={`/rooms/${currentRoom._id}`}
                    className="btn-primary-small"
                  >
                    View Details &amp; Reserve
                  </Link>
                  <Link to="/rooms" className="btn-secondary-small">
                    Browse All Rooms
                  </Link>
                </div>
              </div>

              {/* Carousel Indicators / Dots */}
              {rooms.length > 1 && (
                <div className="carousel-dots-bar" role="tablist" aria-label="Room slides pagination">
                  {rooms.map((room, idx) => (
                    <button
                      key={room._id}
                      type="button"
                      role="tab"
                      aria-selected={idx === activeSlide}
                      aria-label={`Go to slide ${idx + 1}: Room ${room.roomNumber}`}
                      className={`carousel-dot ${idx === activeSlide ? 'active' : ''}`}
                      onClick={() => setActiveSlide(idx)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/*  ACCURATE & PROFESSIONAL ABOUT SECTION */}
      <section className="about-hospitality-section">
        <div className="about-header">
          <p className="section-eyebrow">ABOUT HOTELPRO</p>
          <h2 className="section-heading">Modern Hotel Reservations, Engineered with Precision</h2>
          <p className="section-subheading">
            HotelPro provides a streamlined booking platform with real-time room availability, guaranteed temporary holds, and complete self-service reservation management.
          </p>
        </div>

        <div className="about-pillars-grid">
          <div className="about-pillar-card">
            <div className="pillar-icon">🔍</div>
            <h3>Dynamic Search &amp; Pricing</h3>
            <p>
              Search real-time inventory by your exact travel dates and party size. View full nightly rate breakdowns with zero hidden fees or surprise markups before confirming.
            </p>
            <div className="pillar-metric">
              <span className="metric-val">100%</span>
              <span className="metric-label">Transparent Nightly Rates</span>
            </div>
          </div>

          <div className="about-pillar-card">
            <div className="pillar-icon">⚡</div>
            <h3>15-Minute Reservation Holds</h3>
            <p>
              When you start checkout, your physical room is held exclusively for 15 minutes. This ensures you never lose your dates to a double-booking race condition while entering payment.
            </p>
            <div className="pillar-metric">
              <span className="metric-val">15 Min</span>
              <span className="metric-label">Guaranteed Room Hold</span>
            </div>
          </div>

          <div className="about-pillar-card">
            <div className="pillar-icon">📋</div>
            <h3>Self-Service Management</h3>
            <p>
              Easily review your reservations from your personal dashboard. Access printable payment receipts, update guest details, and manage booking cancellations seamlessly.
            </p>
            <div className="pillar-metric">
              <span className="metric-val">24/7</span>
              <span className="metric-label">Reservation Access</span>
            </div>
          </div>
        </div>
      </section>

      {/*  FEATURED ROOM PREVIEWS GRID */}
      <section className="featured-rooms-section">
        <div className="section-header">
          <p className="section-eyebrow">AVAILABLE ACCOMMODATIONS</p>
          <h2 className="section-heading">Featured Rooms</h2>
          <p className="section-subheading">
            Explore active room listings from our inventory, complete with verified pricing and guest capacity.
          </p>
        </div>

        {isLoadingRooms ? (
          <div className="featured-rooms-grid">
            {[1, 2, 3].map((n) => (
              <div key={n} className="featured-room-card" style={{ height: '380px' }}>
                <div className="carousel-skeleton-media" style={{ height: '220px' }}></div>
                <div style={{ padding: '1.5rem' }}>
                  <div className="skeleton-line" style={{ width: '50%', height: '20px', marginBottom: '0.75rem' }}></div>
                  <div className="skeleton-line" style={{ width: '90%', height: '14px', marginBottom: '0.5rem' }}></div>
                  <div className="skeleton-line" style={{ width: '70%', height: '14px' }}></div>
                </div>
              </div>
            ))}
          </div>
        ) : roomsError ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Room previews are temporarily unavailable. Browse all listings directly in the room search.
            </p>
            <Link to="/rooms" className="btn-primary-small">
              View All Rooms
            </Link>
          </div>
        ) : rooms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              No active rooms are currently available in the catalog.
            </p>
            <Link to="/rooms" className="btn-primary-small">
              Explore Rooms Page
            </Link>
          </div>
        ) : (
          <div className="featured-rooms-grid">
            {rooms.slice(0, 3).map((room) => {
              const photo =
                (Array.isArray(room.photos) && room.photos[0]) ||
                (typeof room.photos === 'string' ? room.photos.split(' ')[0] : null);

              return (
                <div key={room._id} className="featured-room-card">
                  <div className="featured-card-media">
                    {photo ? (
                      <img
                        src={photo}
                        alt={`Room ${room.roomNumber} - ${formatRoomType(room.roomType)}`}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1c1c1e', color: 'var(--text-muted)' }}>
                        <span>Photo unavailable</span>
                      </div>
                    )}
                    <span className="featured-type-tag">
                      {formatRoomType(room.roomType)}
                    </span>
                    <span className="featured-price-pill">
                      {formatPrice(room.basePrice)} <small>/ night</small>
                    </span>
                  </div>

                  <div className="featured-card-body">
                    <div className="featured-card-header-row">
                      <h3 className="featured-card-title">Room {room.roomNumber}</h3>
                      <span className="featured-capacity-badge">
                        👥 {room.capacity} {room.capacity === 1 ? 'Guest' : 'Guests'}
                      </span>
                    </div>
                    <p className="featured-card-desc">
                      {room.description
                        ? room.description.length > 115
                          ? `${room.description.slice(0, 115)}...`
                          : room.description
                        : 'Comfortable and well-appointed room with transparent nightly pricing.'}
                    </p>
                    <div className="featured-card-actions">
                      <Link to={`/rooms/${room._id}`} className="btn-primary-small">
                        View Details &amp; Reserve
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="featured-grid-cta-row">
          <Link to="/rooms" className="btn-secondary">
            <span>Explore All Rooms &amp; Check Availability</span>
            <span className="btn-arrow">→</span>
          </Link>
        </div>
      </section>

      {/*  APPLE BENTO GRID FEATURE SHOWCASE (ENGINEERING GUARANTEES) */}
      <section className="bento-section">
        <div className="section-header">
          <p className="section-eyebrow">SYSTEM ARCHITECTURE</p>
          <h2 className="section-heading">Designed for Reliability. Built for Trust.</h2>
          <p className="section-subheading">
            Behind every reservation lies an atomic hold engine and zero-trust security architecture.
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

      {/*  PHILOSOPHY / CALL TO ACTION */}
      <section className="philosophy-section">
        <div className="philosophy-card">
          <blockquote className="philosophy-quote">
            &ldquo;Technology is at its most powerful when it provides clarity and peace of mind. HotelPro delivers a seamless, dependable reservation experience from search to stay.&rdquo;
          </blockquote>
          <p className="philosophy-author">HotelPro Engineering &amp; Design</p>
          <div className="philosophy-cta">
            <Link to="/rooms" className="btn-primary">
              Find Your Room Today
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
