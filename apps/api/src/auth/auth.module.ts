import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DevicesController } from '../devices/devices.controller';
import { DevicesService } from '../devices/devices.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { issuer: 'sellwasl' },
        verifyOptions: { issuer: 'sellwasl' },
      }),
    }),
  ],
  controllers: [AuthController, PlatformAuthController, DevicesController],
  providers: [TokensService, AuthService, AuthGuard, DevicesService],
  exports: [AuthGuard, TokensService],
})
export class AuthModule {}
