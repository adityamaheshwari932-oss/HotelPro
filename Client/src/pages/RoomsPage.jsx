import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient, ApiError } from '../api/client';
import RoomSearchForm from '../components/RoomSearchForm';
import { getTodayIso, getTomorrowIso, buildRoomSearchParams } from '../utils/roomSearchValidation';
import RoomCard from '../components/RoomCard';

export const RoomsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Extract filters from URL query parameters
  const checkInDateParam = searchParams.get('checkInDate') || getTodayIso();
  const checkOutDateParam = searchParams.get('checkOutDate') || getTomorrowIso();
  const guestsParam = searchParams.get('guests') || '1';
  const roomTypeParam = searchParams.get('roomType') || '';
  const minPriceParam = searchParams.get('minPrice') || '';
  const maxPriceParam = searchParams.get('maxPrice') || '';

  const [rooms, setRooms] = useState([]);
  const [stayInfo, setStayInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Stale request fencing sequence counter
  const requestSeqRef = useRef(0);

  // Sync search execution with URL search parameters and reload key
  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    const currentSeq = ++requestSeqRef.current;

    const executeSearch = async () => {
      setIsLoading(true);
      setApiError('');

      const currentFilters = {
        checkInDate: checkInDateParam,
        checkOutDate: checkOutDateParam,
        guests: guestsParam ? parseInt(guestsParam, 10) : 1,
        roomType: roomTypeParam,
        minPrice: minPriceParam,
        maxPrice: maxPriceParam
      };

      const queryParams = buildRoomSearchParams(currentFilters);

      try {
        const response = await apiClient.get('/rooms/search', {
          params: queryParams,
          signal: controller.signal
        });

        if (isCancelled || currentSeq !== requestSeqRef.current) {
          return;
        }

        setRooms(response?.data?.rooms || []);
        setStayInfo(response?.data?.stay || null);
        setHasSearched(true);
        setIsLoading(false);
      } catch (err) {
        if (
          isCancelled ||
          currentSeq !== requestSeqRef.current ||
          (err instanceof ApiError && err.status === 0 && err.message.includes('cancelled'))
        ) {
          return;
        }

        setIsLoading(false);
        setHasSearched(true);

        if (err instanceof ApiError) {
          setApiError(err.message || 'Failed to search available rooms.');
        } else {
          setApiError('Unable to connect to hotel booking server. Please check your network.');
        }
      }
    };

    executeSearch();

    return () => {
      isCancelled = true;
      controller.abort('Component unmounted or search params changed');
    };
  }, [
    checkInDateParam,
    checkOutDateParam,
    guestsParam,
    roomTypeParam,
    minPriceParam,
    maxPriceParam,
    reloadKey
  ]);

  /**
   * Updates URL search parameters when user submits the search form.
   */
  const handleFormSearch = (filters) => {
    const newParams = {
      checkInDate: filters.checkInDate,
      checkOutDate: filters.checkOutDate
    };

    if (filters.guests) newParams.guests = String(filters.guests);
    if (filters.roomType) newParams.roomType = filters.roomType;
    if (filters.minPrice !== undefined && filters.minPrice !== '') newParams.minPrice = String(filters.minPrice);
    if (filters.maxPrice !== undefined && filters.maxPrice !== '') newParams.maxPrice = String(filters.maxPrice);

    setSearchParams(newParams);
  };

  const handleRetry = () => {
    setReloadKey((prev) => prev + 1);
  };

  return (
    <div className="rooms-page-container">
      <div className="rooms-page-header">
        <span className="hero-badge-pill"> Sanctuaries Catalog</span>
        <h1>Curated HotelPro Sanctuaries</h1>
        <p className="rooms-page-subtitle">
          Engineered for serenity. Instant dynamic availability, transparent nightly breakdowns, and autonomous 15-minute reservation holds.
        </p>
      </div>

      <div className="search-form-card">
        <RoomSearchForm
          onSearch={handleFormSearch}
          initialValues={{
            checkInDate: checkInDateParam,
            checkOutDate: checkOutDateParam,
            guests: guestsParam,
            roomType: roomTypeParam,
            minPrice: minPriceParam,
            maxPrice: maxPriceParam
          }}
          isLoading={isLoading}
        />
      </div>

      {apiError && (
        <div className="alert-error" role="alert" aria-live="assertive">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <p className="alert-message">{apiError}</p>
            <button type="button" className="btn-retry" onClick={handleRetry}>
              Try Again
            </button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="rooms-loading-state" role="status" aria-live="polite">
          <div className="auth-spinner" aria-hidden="true"></div>
          <p>Checking live room availability and pricing...</p>
        </div>
      )}

      {!isLoading && !apiError && hasSearched && (
        <section className="search-results-section" aria-label="Available Room Results">
          <div className="results-summary-bar">
            {stayInfo ? (
              <p className="summary-text">
                Showing <strong>{rooms.length}</strong> available {rooms.length === 1 ? 'room' : 'rooms'} for{' '}
                <span className="highlight-date">{stayInfo.checkInDate}</span> to{' '}
                <span className="highlight-date">{stayInfo.checkOutDate}</span> ({stayInfo.nights}{' '}
                {stayInfo.nights === 1 ? 'night' : 'nights'})
              </p>
            ) : (
              <p className="summary-text">Showing {rooms.length} available rooms</p>
            )}
          </div>

          {rooms.length > 0 ? (
            <div className="rooms-grid">
              {rooms.map((room) => (
                <RoomCard
                  key={room._id}
                  room={room}
                  stay={{
                    checkInDate: stayInfo?.checkInDate || checkInDateParam,
                    checkOutDate: stayInfo?.checkOutDate || checkOutDateParam,
                    nights: stayInfo?.nights || 1,
                    guests: guestsParam
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty-results-box">
              <span className="empty-icon" aria-hidden="true">
                🏨
              </span>
              <h3>No Rooms Available for These Dates</h3>
              <p>
                All rooms matching your selected filters are either booked, reserved under active holds, or exceed the capacity/price criteria.
              </p>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    handleFormSearch({
                      checkInDate: checkInDateParam,
                      checkOutDate: checkOutDateParam,
                      guests: 1,
                      roomType: '',
                      minPrice: '',
                      maxPrice: ''
                    })
                  }
                >
                  Clear Optional Filters
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default RoomsPage;
