import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash, compare } from 'bcrypt';
import { Repository } from 'typeorm';
import User from '@root/entities/User.entity';
import {
  DBError,
  DuplicateKakaoIdError,
  UnauthorizedError,
  DuplicateNicknameError,
} from '@root/error/serverError';
import FindUserDto from '@users/dto/find.user.dto';
import JoinRequestDto from '@users/dto/join.request.dto';

@Injectable()
export default class UsersService {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {}

  async joinUser(user: JoinRequestDto) {
    try {
      const userId = await this.userRepository
        .createQueryBuilder()
        .insert()
        .into(User)
        .values(user)
        .execute();
      return userId;
    } catch (e) {
      const errorType = e.code;
      if (errorType === 'ER_DUP_ENTRY') {
        if (e.sqlMessage.includes(process.env.DB_USERS_KAKAOID_UNIQUE))
          throw new DuplicateKakaoIdError();
        else throw new DuplicateNicknameError();
      }
      throw new DBError('DBError: joinUser .save() 오류');
    }
  }

  async getUser(findUserInterface: FindUserDto & Record<string, unknown>) {
    try {
      const user = await this.userRepository.findOne({
        where: findUserInterface,
      });
      return user;
    } catch (e) {
      throw new DBError('DBError: getUser 오류');
    }
  }

  async getUserList(nickname: string, maxRecord: number, reqClientId: number) {
    try {
      console.log(reqClientId);
      const userList = await this.userRepository
        .createQueryBuilder()
        .select(['id', 'nickname'])
        .where(`MATCH(nickname) AGAINST ('+${nickname}*' IN BOOLEAN MODE)`)
        .limit(maxRecord)
        .execute();
      return userList.filter((user) => user.id !== reqClientId);
    } catch (e) {
      throw new DBError('DBError: getUserList 오류');
    }
  }

  async setCurrentRefreshToken(refreshtoken: string, id: number) {
    const currentHashedRefreshToken = await hash(refreshtoken, 10);
    await this.userRepository.update(id, { currentHashedRefreshToken });
  }

  async getUserIfRefreshTokenMatches(refreshtoken: string, id: number) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new UnauthorizedError();
    const isRefreshTokenMatched = await compare(
      refreshtoken,
      user.currentHashedRefreshToken,
    );
    if (!isRefreshTokenMatched) throw new UnauthorizedError();
    return user;
  }

  async removeRefreshToken(id: number) {
    try {
      await this.userRepository.update(id, {
        currentHashedRefreshToken: null,
      });
    } catch (e) {
      throw new DBError('DBError: removeRefreshToken 오류');
    }
  }
}
