import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * User role definitions
 */
export type UserRole = 
  | 'super_admin' 
  | 'admin' 
  | 'operator' 
  | 'developer' 
  | 'viewer';

/**
 * User information
 */
export interface User {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  avatar?: string;
}

/**
 * Auth state interface
 */
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  setUser: (user: User | null) => void;
  login: (user: User) => void;
  logout: () => void;
  
  // Permission checks
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;
}

/**
 * Default development user with super admin access
 * This is used when no user is set (development mode)
 */
const DEV_USER: User = {
  id: 'dev-user-001',
  email: 'admin@quantix.local',
  name: 'Development Admin',
  roles: ['super_admin', 'admin'],
};

/**
 * Auth store using Zustand with persistence
 * Stores auth state in localStorage for session persistence
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Default to dev user for development
      user: DEV_USER,
      isAuthenticated: true,
      isLoading: false,

      setUser: (user) => set({ 
        user, 
        isAuthenticated: user !== null 
      }),

      login: (user) => set({ 
        user, 
        isAuthenticated: true,
        isLoading: false,
      }),

      logout: () => set({ 
        user: null, 
        isAuthenticated: false,
        isLoading: false,
      }),

      isSuperAdmin: () => {
        const { user } = get();
        if (!user) return false;
        return user.roles.includes('super_admin');
      },

      isAdmin: () => {
        const { user } = get();
        if (!user) return false;
        return user.roles.includes('super_admin') || user.roles.includes('admin');
      },

      hasRole: (role) => {
        const { user } = get();
        if (!user) return false;
        return user.roles.includes(role);
      },

      hasAnyRole: (roles) => {
        const { user } = get();
        if (!user) return false;
        return roles.some(role => user.roles.includes(role));
      },
    }),
    {
      name: 'quantix-auth',
      // Only persist user data
      partialize: (state) => ({ 
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

/**
 * Hook to check if current user has admin panel access
 */
export function useAdminAccess(): boolean {
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  return isSuperAdmin();
}

/**
 * Hook to get current user
 */
export function useCurrentUser(): User | null {
  return useAuthStore((state) => state.user);
}
