export { AuthModule } from './auth.module';
export { AuthService } from './application/auth.service';
export { JwtAuthGuard, RolesGuard, CurrentUser, Public, Roles } from './infrastructure/guards';
export type { JwtPayload, UserRole } from './domain/entities/user.entity';

