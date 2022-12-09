import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Feed } from '@root/entities/Feed.entity';
import UserFeedMapping from '@root/entities/UserFeedMapping.entity';
import {
  GroupFeedMembersCountError,
  NonExistFeedError,
} from '@root/custom/customError/serverError';
import User from '@root/entities/User.entity';
import CreateFeedDto from '@feed/dto/create.feed.dto';
import { decrypt, encrypt } from '@feed/feed.utils';
import FindFeedDto from '@feed/dto/find.feed.dto';
import FeedInfoDto from '@feed/dto/info.feed.dto';
import FeedResponseDto from './dto/response/feed.response.dto';

@Injectable()
export class FeedService {
  constructor(
    @InjectRepository(Feed) private feedRepository: Repository<Feed>,
    @InjectRepository(UserFeedMapping)
    private userFeedMappingRepository: Repository<UserFeedMapping>,
    private dataSource: DataSource,
  ) {}

  async getFeedInfo(encryptedFeedID: string, userId: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const id = Number(decrypt(encryptedFeedID));
      const feed = await this.dataSource.getRepository(Feed).find({
        where: { id },
        relations: ['postings', 'users'],
        select: {
          postings: { id: true },
          users: { userId: true },
          name: true,
          description: true,
          thumbnail: true,
          dueDate: true,
        },
      });
      const feedInfoDto = FeedInfoDto.createFeedInfoDto(feed[0], userId);
      if (feedInfoDto.isOwner) {
        await this.dataSource
          .getRepository(User)
          .update(userId, { lastVistedFeed: id });
      }
      return feedInfoDto;
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async getFeedById(encryptedFeedID: string) {
    const id = Number(decrypt(encryptedFeedID));
    const feed = await this.dataSource.getRepository(Feed).find({
      where: { id },
    });

    return feed[0];
  }

  async getFeed(findFeedReq: FindFeedDto & Record<string, unknown>) {
    const findFeedDto: FindFeedDto = { ...findFeedReq };
    const encryptId = findFeedDto.encryptedId;
    if (encryptId) {
      delete findFeedDto.encryptedId;
      findFeedDto.id = Number(decrypt(encryptId));
    }

    const feed = await this.dataSource
      .getRepository(Feed)
      .find({ where: findFeedDto });
    return feed[0];
  }

  async getPostingThumbnails(
    encryptedFeedID: string,
    startPostingId: number,
    scrollSize: number,
  ) {
    const id = Number(decrypt(encryptedFeedID));
    const postingThumbnailList = await this.dataSource
      .getRepository(Feed)
      .createQueryBuilder('feed')
      .innerJoin('feed.postings', 'posting')
      .select(['posting.id as id', 'posting.thumbnail as thumbanil'])
      .where('feed.id = :id', { id })
      .andWhere('posting.id > :startPostingId', { startPostingId })
      .limit(scrollSize)
      .getRawMany();

    // 쿼리 2번 - 추후쿼리 최적화 때 속도 비교
    // const postingThumbnailList2 = await this.dataSource
    //   .getRepository(Feed)
    //   .find({
    //     select: { postings: { id: true, thumbnail: true } },
    //     relations: ['postings'],
    //     where: { id, postings: { id: MoreThan(startPostingId) } },
    //     take: postingCount,
    //   });

    return postingThumbnailList;
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
      await queryRunner.manager
        .getRepository(User)
        .update({ id: userId }, { lastVistedFeed: feed.id });
      await queryRunner.commitTransaction();
      return FeedResponseDto.makeFeedResponseDto(feed).encryptedId;
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async createGroupFeed(createFeedDto: CreateFeedDto, memberIdList: number[]) {
    // 그룹 피드 멤버 2명 이상 100명 미만인지 체크
    if (!memberIdList || memberIdList.length < 2 || memberIdList.length > 100)
      throw new GroupFeedMembersCountError();

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
      await queryRunner.rollbackTransaction();
      throw e;
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
      await queryRunner.rollbackTransaction();
      throw e;
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
      throw new GroupFeedMembersCountError();

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
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async getGroupFeedList(userId: number) {
    const subQuery = await this.dataSource
      .createQueryBuilder()
      .select('feedId')
      .from(UserFeedMapping, 'user_feed_mapping')
      .where('user_feed_mapping.feedId = feeds.id')
      .andWhere('user_feed_mapping.userId = :userId', { userId });

    const feedList = await this.dataSource
      .createQueryBuilder()
      .select(['id', 'name', 'thumbnail'])
      .from(Feed, 'feeds')
      .where(`EXISTS (${subQuery.getQuery()})`)
      .andWhere('isGroupFeed = :isGroupFeed', { isGroupFeed: true })
      .setParameters(subQuery.getParameters())
      .execute();
    return FeedResponseDto.makeFeedResponseArray(feedList);
  }

  async getPersonalFeedList(userId: number) {
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
    return FeedResponseDto.makeFeedResponseArray(feedList);
  }

  async checkFeedOwner(id: number, feedId: string) {
    const owner = await this.userFeedMappingRepository
      .createQueryBuilder('user_feed_mapping')
      .where('user_feed_mapping.userId = :userId', { userId: id })
      .andWhere('user_feed_mapping.feedId = :feedId', { feedId })
      .getOne();
    return owner;
  }
}
