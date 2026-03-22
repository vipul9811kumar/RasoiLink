export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface AuthUser {
  user_id: string;
  user_type: string;
  phone: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}
