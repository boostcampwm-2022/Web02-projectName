import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Feed } from '@root/entities/Feed.entity';
import UserFeedMapping from '@root/entities/UserFeedMapping.entity';
import {
  DBError,
  GroupFeedMemberListCountException,
  InvalidFKConstraintError,
  NonExistFeedError,
  NonExistUserError,
} from '@root/error/serverError';
import CreateFeedDto from './dto/create.feed.dto';
import { decrypt, encrypt } from './feed.utils';
import FindFeedDto from './dto/find.feed.dto';

@Injectable()
export class FeedService {
  constructor(
    @InjectRepository(Feed) private feedRepository: Repository<Feed>,
    @InjectRepository(UserFeedMapping)
    private userFeedMappingRepository: Repository<UserFeedMapping>,
    private dataSource: DataSource,
  ) {}

  async getFeed(findFeedReq: FindFeedDto & Record<string, unknown>) {
    try {
      const findFeedDto: FindFeedDto = { ...findFeedReq };
      const encryptId = findFeedDto.encryptedId;
      if (encryptId) {
        delete findFeedDto.encryptedId;
        findFeedDto.id = Number(decrypt(encryptId));
      }

      const feed = await this.dataSource
        .getRepository(Feed)
        .find({ where: findFeedDto });
      return feed;
    } catch (e) {
      throw new DBError('DBError: getUser 오류');
    }
  }

  async getFeedById(encryptedFeedID: string) {
    try {
      const id = Number(decrypt(encryptedFeedID));
      const feed = await this.dataSource
        .getRepository(Feed)
        .find({ where: { id } });

      if (!feed) throw new NonExistFeedError();
      return {
        name: feed[0].name,
        description: feed[0].description,
        thumbnail: feed[0].thumbnail,
        dueDate: feed[0].dueDate,
      };
    } catch (e) {
      console.log(e);
      if (
        e instanceof NonExistFeedError ||
        e.message.includes('digital envelope routines')
      )
        throw e;
      throw new DBError('DBError: getUser 오류');
    }
  }

  async createFeed(createFeedDto: CreateFeedDto, userId: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const feed = await queryRunner.manager
        .getRepository(Feed)
        .save({ ...createFeedDto, isGroupFeed: false });

      await queryRunner.manager
        .getRepository(UserFeedMapping)
        .save({ feedId: feed.id, userId });

      await queryRunner.commitTransaction();
      return encrypt(feed.id.toString());
    } catch (e) {
      const errorType = e.code;
      await queryRunner.rollbackTransaction();

      if (errorType === 'ER_NO_REFERENCED_ROW_2') throw new NonExistUserError();

      throw new DBError('DBError: createFeed 오류');
    } finally {
      await queryRunner.release();
    }
  }

  async createGroupFeed(createFeedDto: CreateFeedDto, memberIdList: number[]) {
    // 그룹 피드 멤버 2명 이상 100명 미만인지 체크
    if (!memberIdList || memberIdList.length < 2 || memberIdList.length > 100)
      throw new GroupFeedMemberListCountException();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 새로운 피드 생성
      const feed = await queryRunner.manager
        .getRepository(Feed)
        .insert({ ...createFeedDto, isGroupFeed: true });
      const feedId: number = feed.identifiers[0].id;

      // useFeedMappingTable 삽입
      for await (const userId of memberIdList) {
        const id = await queryRunner.manager
          .getRepository(UserFeedMapping)
          .insert({ feedId, userId });
      }

      await queryRunner.commitTransaction();
      return encrypt(feedId.toString());
    } catch (e) {
      const errorType = e.code;
      await queryRunner.rollbackTransaction();

      if (errorType === 'ER_NO_REFERENCED_ROW_2') throw new NonExistUserError();

      throw new DBError('DBError: createGroupFeed 오류');
    } finally {
      await queryRunner.release();
    }
  }

  async editFeed(createFeedDto: CreateFeedDto, feedId: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager
        .getRepository(Feed)
        .update({ id: feedId }, createFeedDto);

      await queryRunner.commitTransaction();
    } catch (e) {
      const errorType = e.code;
      await queryRunner.rollbackTransaction();

      if (errorType === 'ER_NO_REFERENCED_ROW_2') throw new NonExistFeedError();

      throw new DBError('DBError: editFeed 오류');
    } finally {
      await queryRunner.release();
    }
  }

  async editGroupFeed(
    createFeedDto: CreateFeedDto,
    feedId: number,
    memberIdList: number[],
  ) {
    // 그룹 피드 멤버 2명 이상 100명 미만인지 체크
    if (!memberIdList || memberIdList.length < 2 || memberIdList.length > 100)
      throw new GroupFeedMemberListCountException();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 피드 정보 업데이트
      await queryRunner.manager
        .getRepository(Feed)
        .update({ id: feedId }, createFeedDto);

      // 그룹 피드 멤버 정보(user_feed_mapping) 업데이트
      const prevMemberList = await queryRunner.manager
        .getRepository(UserFeedMapping)
        .find({ where: { feedId }, select: { userId: true } });

      const prevMemberIdList = prevMemberList.map((member) => member.userId);

      // 1. 삭제
      for await (const userId of prevMemberIdList) {
        if (!memberIdList.includes(userId)) {
          await queryRunner.manager
            .getRepository(UserFeedMapping)
            .delete({ userId });
        }
      }

      // 2. 추가
      for await (const userId of memberIdList) {
        if (!prevMemberIdList.includes(userId)) {
          await queryRunner.manager
            .getRepository(UserFeedMapping)
            .save({ feedId, userId });
        }
      }

      await queryRunner.commitTransaction();
    } catch (e) {
      const errorType = e.code;
      await queryRunner.rollbackTransaction();

      if (errorType === 'ER_NO_REFERENCED_ROW_2')
        throw new InvalidFKConstraintError();

      throw new DBError('DBError: editGroupFeed 오류');
    } finally {
      await queryRunner.release();
    }
  }

  async getGroupFeedList(userId: number) {
    try {
      const subQuery = await this.dataSource
        .createQueryBuilder()
        .select('feedId')
        .from(UserFeedMapping, 'user_feed_mapping')
        .where('user_feed_mapping.feedId = feeds.id')
        .andWhere('user_feed_mapping.userId = :userId', { userId });

      const feedList = await this.dataSource
        .createQueryBuilder()
        .select(['id AS feed_id', 'name AS feed_name', 'thumbnail'])
        .from(Feed, 'feeds')
        .where(`EXISTS (${subQuery.getQuery()})`)
        .andWhere('isGroupFeed = :isGroupFeed', { isGroupFeed: true })
        .setParameters(subQuery.getParameters())
        .execute();

      return feedList;
    } catch (e) {
      const errorType = e.code;

      if (errorType === 'ER_NO_REFERENCED_ROW_2')
        throw new InvalidFKConstraintError();

      throw new DBError('DBError: editGroupFeed 오류');
    }
  }

  async getPersonalFeedList(userId: number) {
    try {
      const feedList = await this.userFeedMappingRepository
        .createQueryBuilder('user_feed_mapping')
        .innerJoin('user_feed_mapping.feed', 'feeds')
        .select([
          'feeds.id as id',
          'feeds.name as name',
          'feeds.thumbnail as thumbnail',
        ])
        .where('feeds.isGroupFeed = :isGroupFeed', { isGroupFeed: 0 })
        .andWhere('user_feed_mapping.userId = :userId', { userId })
        .getRawMany();
      return feedList;
    } catch (e) {
      throw new DBError('DB Error : getFeedList 오류');
    }
  }

  async checkFeedOwner(id: number, feedId: string) {
    try {
      const owner = await this.userFeedMappingRepository
        .createQueryBuilder('user_feed_mapping')
        .where('user_feed_mapping.userId = :userId', { userId: id })
        .andWhere('user_feed_mapping.feedId = :feedId', { feedId })
        .getOne();
      return owner;
    } catch (e) {
      throw new DBError('DB Error : checkFeedOwner 오류 ');
    }
  }
}
