import { createContext } from 'react';

/**
 * React Context definition for authentication state.
 * Separated from components to enable fast-refresh optimization.
 */
export const AuthContext = createContext(null);

export default AuthContext;
