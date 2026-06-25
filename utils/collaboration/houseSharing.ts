// FOSS placeholder: cloud builds replace this file with Supabase-backed house
// sharing. Public builds keep these types and no-op responses so shared house
// screens can compile without enabling collaboration.

export type HouseRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type InviteRole = 'admin' | 'editor' | 'viewer';

export type HouseInvite = {
  id: string;
  invitee_name: string;
  role: InviteRole;
  status: 'active' | 'accepted' | 'revoked' | 'expired';
  code_mask: string;
  expires_at: string;
  created_at: string;
};

export type HouseMember = {
  user_id: string;
  role: HouseRole;
  display_name: string | null;
  profile_display_name: string | null;
};

export type HouseCollaboration = {
  allowed: boolean;
  house_id: string;
  owner_id: string;
  sharing_active: boolean;
  my_role: HouseRole | null;
  permissions: {
    is_owner: boolean;
    can_admin: boolean;
    can_edit_house: boolean;
    can_write_content: boolean;
    can_leave: boolean;
  };
  members: HouseMember[];
  invites: HouseInvite[];
  limits: {
    member_limit: number;
    member_count: number;
    active_invite_count: number;
    slots_left: number;
  };
  sync_required: boolean;
};

const unavailable = () => new Error('House sharing is not available in this edition.');

export const getHouseCollaboration = async (houseId: string): Promise<HouseCollaboration> => ({
  allowed: false,
  house_id: houseId,
  owner_id: '',
  sharing_active: false,
  my_role: null,
  permissions: {
    is_owner: false,
    can_admin: false,
    can_edit_house: false,
    can_write_content: false,
    can_leave: false,
  },
  members: [],
  invites: [],
  limits: { member_limit: 0, member_count: 0, active_invite_count: 0, slots_left: 0 },
  sync_required: false,
});

export const createHouseInvitation = async (_params: {
  houseId: string;
  inviteeName: string;
  role: InviteRole;
}) => {
  throw unavailable();
};
export const revokeHouseInvitation = async (_invitationId: string) => {
  throw unavailable();
};
export const updateHouseMember = async (_params: {
  houseId: string;
  userId: string;
  role: InviteRole;
  displayName?: string;
}) => {
  throw unavailable();
};
export const removeHouseMember = async (_params: { houseId: string; userId: string }) => {
  throw unavailable();
};
export const leaveHouse = async (_houseId: string) => {
  throw unavailable();
};
export const lookupInvite = async (_code: string) => ({ valid: false });
export const acceptHouseInvitation = async (_code: string) => {
  throw unavailable();
};
