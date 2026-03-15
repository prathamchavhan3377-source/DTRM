export type UserRole = 'donor' | 'ngo';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  organizationName: string;
  phoneNumber?: string;
  address?: string;
  createdAt: any;
}

export type DonationStatus = 'available' | 'claimed' | 'picked_up' | 'cancelled';

export interface Donation {
  id: string;
  donorId: string;
  donorName: string;
  foodTitle: string;
  quantity: string;
  description?: string;
  pickupLocation: string;
  expiryTime?: any;
  status: DonationStatus;
  ngoId?: string;
  ngoName?: string;
  createdAt: any;
  claimedAt?: any;
}
