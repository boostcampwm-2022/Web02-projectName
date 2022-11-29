import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthenticationService } from '../authentication/authentication.service';
import { InvalidNickname } from '../custom/customValidators/nicknameValidate';
import User from '../entities/User.entity';

import { OauthModule } from '../oauth/oauth.module';
import UsersController from './users.controller';
import UserFacade from './users.facade';
import UsersService from './users.service';

@Module({
  imports: [OauthModule, TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserFacade,
    AuthenticationService,
    JwtService,
    InvalidNickname,
  ],
  exports: [UsersService],
})
export default class UsersModule {}
