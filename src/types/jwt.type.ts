export interface JwtPayload {
  email: string;
  role: string;
  iat: number;
  exp: number;
}
