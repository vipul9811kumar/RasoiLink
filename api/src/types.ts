export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta: {
    timestamp: string;
    duration_ms: number;
  };
}

export interface AuthUser {
  user_id: string;
  user_type: 'worker' | 'owner' | 'admin';
  phone: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
