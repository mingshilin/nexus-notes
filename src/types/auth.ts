export interface AuthUser {
  id: string;
  email: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  email_verified_at: string | null;
  created_at: string;
  current_workspace?: {
    id: string;
    name: string;
    owner_user_id: string;
    role?: "owner" | "editor" | "viewer";
  };
}

export interface RegisterPayload {
  email: string;
  password: string;
  turnstile_token?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  turnstile_token?: string;
}

export interface PendingVerificationAuth {
  pending_verification: true;
  email: string;
  email_masked: string;
  verification_expires_at: string;
}

export interface VerifyEmailCodePayload {
  email: string;
  code: string;
}
