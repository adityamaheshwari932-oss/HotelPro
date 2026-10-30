import React, { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context';
import AdminBookingsPage from './AdminBookingsPage';
import AdminRoomsTab from '../components/admin/AdminRoomsTab';
import AdminAddRoomTab from '../components/admin/AdminAddRoomTab';
import AdminUsersTab from '../components/admin/AdminUsersTab';

const TABS = [
  { id: 'bookings', label: 'All Bookings', icon: '📋' },
  { id: 'rooms', label: 'All Rooms', icon: '🏨' },
  { id: 'add-room', label: 'Add Room', icon: '➕' },
  { id: 'users', label: 'All Users', icon: '👥' }
];

export const AdminHomePage = ({ initialTab }) => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabListRef = useRef(null);

  const currentTab = searchParams.get('tab') || initialTab || 'bookings';

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  const handleKeyDown = (e, index) => {
    let targetIndex = null;

    if (e.key === 'ArrowRight') {
      targetIndex = (index + 1) % TABS.length;
    } else if (e.key === 'ArrowLeft') {
      targetIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = TABS.length - 1;
    }

    if (targetIndex !== null) {
      e.preventDefault();
      const targetTab = TABS[targetIndex];
      handleTabChange(targetTab.id);

      // Focus the newly selected tab button
      const buttons = tabListRef.current?.querySelectorAll('button[role="tab"]');
      if (buttons && buttons[targetIndex]) {
        buttons[targetIndex].focus();
      }
    }
  };

  const adminName = user?.name ? user.name.trim() : 'Administrator';

  return (
    <div className="admin-dashboard-container" data-testid="admin-home-page">
      {/* Personalized Header Hero */}
      <div className="admin-dashboard-header">
        <div className="admin-header-content">
          <div className="admin-badge-row">
            <span className="admin-pill-badge" data-testid="admin-badge">
              🛡️ Admin Control Panel
            </span>
            <span className="admin-role-indicator">
              Role: <strong>{user?.role ? user.role.toUpperCase() : 'ADMIN'}</strong>
            </span>
          </div>
          <h1 className="admin-welcome-heading" data-testid="admin-greeting">
            Welcome back, {adminName}
          </h1>
          <p className="admin-welcome-subtext">
            Centralized operations for HotelPro reservations, room inventory management, and user administration.
          </p>
        </div>
      </div>

      {/* Primary Accessible Tab Bar */}
      <div
        className="admin-main-tabs"
        role="tablist"
        aria-label="Admin Dashboard Sections"
        ref={tabListRef}
        data-testid="admin-main-tabs"
      >
        {TABS.map((tab, idx) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`admin-main-tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              data-testid={`admin-tab-${tab.id}`}
            >
              <span className="tab-icon" aria-hidden="true">
                {tab.icon}
              </span>
              <span className="tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div className="admin-panel-container">
        {currentTab === 'bookings' && (
          <div
            id="panel-bookings"
            role="tabpanel"
            aria-labelledby="tab-bookings"
            className="admin-tab-panel"
          >
            <AdminBookingsPage embedded={true} />
          </div>
        )}

        {currentTab === 'rooms' && (
          <div
            id="panel-rooms"
            role="tabpanel"
            aria-labelledby="tab-rooms"
            className="admin-tab-panel"
          >
            <AdminRoomsTab onNavigateToAddRoom={() => handleTabChange('add-room')} />
          </div>
        )}

        {currentTab === 'add-room' && (
          <div
            id="panel-add-room"
            role="tabpanel"
            aria-labelledby="tab-add-room"
            className="admin-tab-panel"
          >
            <AdminAddRoomTab onRoomCreated={() => handleTabChange('rooms')} />
          </div>
        )}

        {currentTab === 'users' && (
          <div
            id="panel-users"
            role="tabpanel"
            aria-labelledby="tab-users"
            className="admin-tab-panel"
          >
            <AdminUsersTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminHomePage;
