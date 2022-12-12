import { Injectable, CACHE_MANAGER, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Feed } from '@root/entities/Feed.entity';
import { Cache } from 'cache-manager';
import UserFeedMapping from '@root/entities/UserFeedMapping.entity';
import {
  GroupFeedMembersCountError,
  NonExistFeedError,
} from '@root/custom/customError/serverError';
import { UserRepository } from '@root/users/users.repository';
import User from '@root/entities/User.entity';
import CreateFeedDto from '@feed/dto/create.feed.dto';
import { decrypt, encrypt } from '@feed/feed.utils';
import FindFeedDto from '@feed/dto/find.feed.dto';
import FeedInfoDto from '@feed/dto/info.feed.dto';
import FeedResponseDto from './dto/response/feed.response.dto';
import { FeedRepository } from './feed.repository';

@Injectable()
export class FeedService {
  constructor(
    private feedRepository2: FeedRepository,
    private userRepository: UserRepository,
    @InjectRepository(UserFeedMapping)
    private userFeedMappingRepository: Repository<UserFeedMapping>,
    private dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getFeedInfo(encryptedFeedID: string, userId: number) {
    const id = Number(decrypt(encryptedFeedID));
    const cachedResult = await this.cacheManager.get(`${id}`);
    if (cachedResult) {
      return cachedResult;
    }
    const feed = await this.feedRepository2.getFeed(id);
    const feedInfoDto = FeedInfoDto.createFeedInfoDto(feed[0], userId);
    if (feedInfoDto.isOwner) {
      await this.userRepository.updateLastVisitedFeed(userId, id);
    }
    return feedInfoDto;
  }

  async getFeedById(encryptedFeedID: string) {
    const id = Number(decrypt(encryptedFeedID));
    const findFeedDto = new FindFeedDto(id);
    const feed = await this.feedRepository2.getFeedByFindFeedDto(findFeedDto);
    return feed[0];
  }

  async getFeed(findFeedReq: FindFeedDto & Record<string, unknown>) {
    const findFeedDto: FindFeedDto = { ...findFeedReq };
    const encryptId = findFeedDto.encryptedId;
    if (encryptId) {
      delete findFeedDto.encryptedId;
      findFeedDto.id = Number(decrypt(encryptId));
    }
    const feed = await this.feedRepository2.getFeedByFindFeedDto(findFeedDto);
    return feed[0];
  }

  async getPostingThumbnails(
    encryptedFeedID: string,
    startPostingId: number,
    scrollSize: number,
  ) {
    const id = Number(decrypt(encryptedFeedID));
    const postingThumbnailList = await this.feedRepository2.getThumbnailList(
      startPostingId,
      scrollSize,
      id,
    );

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
    // const queryRunner = this.dataSource.createQueryRunner();
    // await queryRunner.connect();
    // await queryRunner.startTransaction();
    // try {
    //   const feed = await queryRunner.manager.save(Feed, {
    //     ...createFeedDto,
    //     isGroupFeed: false,
    //   });
    //   await queryRunner.manager
    //     .getRepository(UserFeedMapping)
    //     .save({ feedId: feed.id, userId });
    //   await this.cacheManager.set(`${feed.id}`, createFeedDto);
    //   await queryRunner.manager.update(User, userId, {
    //     lastVistedFeed: feed.id,
    //   });
    //   await queryRunner.commitTransaction();
    //   return FeedResponseDto.makeFeedResponseDto(feed).encryptedId;
    // } catch (e) {
    //   await queryRunner.rollbackTransaction();
    //   throw e;
    // } finally {
    //   await queryRunner.release();
    // }
    let feed: Feed;
    await this.dataSource.transaction(async (manager) => {
      feed = await manager.save(Feed, {
        ...createFeedDto,
        isGroupFeed: false,
      });
      await manager.insert(UserFeedMapping, { feedId: feed.id, userId });
      await this.cacheManager.set(`${feed.id}`, createFeedDto);
      await manager.update(User, userId, { lastVistedFeed: feed.id });
    });
    return FeedResponseDto.makeFeedResponseDto(feed).encryptedId;
  }

  async createGroupFeed(createFeedDto: CreateFeedDto, memberIdList: number[]) {
    // 그룹 피드 멤버 2명 이상 100명 미만인지 체크
    if (!memberIdList || memberIdList.length < 2 || memberIdList.length > 100)
      throw new GroupFeedMembersCountError();

    // const queryRunner = this.dataSource.createQueryRunner();
    // await queryRunner.connect();
    // await queryRunner.startTransaction();

    // try {
    //   // 새로운 피드 생성
    //   const feed = await queryRunner.manager.save(Feed, {
    //     ...createFeedDto,
    //     isGroupFeed: true,
    //   });

    //   // useFeedMappingTable 삽입
    //   for await (const userId of memberIdList) {
    //     const id = await queryRunner.manager
    //       .getRepository(UserFeedMapping)
    //       .insert({ feedId: feed.id, userId });
    //   }

    //   await queryRunner.commitTransaction();
    //   return encrypt(feed.id.toString());
    // } catch (e) {
    //   await queryRunner.rollbackTransaction();
    //   throw e;
    // } finally {
    //   await queryRunner.release();
    // }
    let feed: Feed;
    await this.dataSource.transaction(async (manager) => {
      feed = await manager.save(Feed, {
        ...createFeedDto,
        isGroupFeed: true,
      });
      for await (const userId of memberIdList) {
        await manager.insert(UserFeedMapping, {
          feedId: feed.id,
          userId,
        });
      }
      await this.cacheManager.set(`${feed.id}`, createFeedDto);
    });
    return FeedResponseDto.makeFeedResponseDto(feed).encryptedId;
  }

  async editFeed(createFeedDto: CreateFeedDto, feedId: number) {
    // const queryRunner = this.dataSource.createQueryRunner();
    // await queryRunner.connect();
    // await queryRunner.startTransaction();
    // try {
    //   await queryRunner.manager.update(Feed, { id: feedId }, createFeedDto);
    //   await this.cacheManager.set(`${feedId}`, createFeedDto);
    //   await queryRunner.commitTransaction();
    // } catch (e) {
    //   await queryRunner.rollbackTransaction();
    //   throw e;
    // } finally {
    //   await queryRunner.release();
    // }
    await this.feedRepository2.updateFeed(feedId, createFeedDto);
    await this.cacheManager.set(`${feedId}`, createFeedDto);
  }

  async editGroupFeed(
    createFeedDto: CreateFeedDto,
    feedId: number,
    memberIdList: number[],
  ) {
    // 그룹 피드 멤버 2명 이상 100명 미만인지 체크
    if (!memberIdList || memberIdList.length < 2 || memberIdList.length > 100)
      throw new GroupFeedMembersCountError();

    // const queryRunner = this.dataSource.createQueryRunner();
    // await queryRunner.connect();
    // await queryRunner.startTransaction();

    // try {
    //   // 피드 정보 업데이트
    //   await queryRunner.manager
    //     .getRepository(Feed)
    //     .update({ id: feedId }, createFeedDto);

    //   // 그룹 피드 멤버 정보(user_feed_mapping) 업데이트
    //   const prevMemberList = await queryRunner.manager
    //     .getRepository(UserFeedMapping)
    //     .find({ where: { feedId }, select: { userId: true } });

    //   const prevMemberIdList = prevMemberList.map((member) => member.userId);

    //   // 1. 삭제
    //   for await (const userId of prevMemberIdList) {
    //     if (!memberIdList.includes(userId)) {
    //       await queryRunner.manager
    //         .getRepository(UserFeedMapping)
    //         .delete({ userId });
    //     }
    //   }

    //   // 2. 추가
    //   for await (const userId of memberIdList) {
    //     if (!prevMemberIdList.includes(userId)) {
    //       await queryRunner.manager
    //         .getRepository(UserFeedMapping)
    //         .save({ feedId, userId });
    //     }
    //   }

    //   await queryRunner.commitTransaction();
    // } catch (e) {
    //   await queryRunner.rollbackTransaction();
    //   throw e;
    // } finally {
    //   await queryRunner.release();
    // }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Feed,
        { id: feedId },
        {
          ...createFeedDto,
          isGroupFeed: true,
        },
      );
      const prevMemberList = await manager.find(UserFeedMapping, {
        where: { feedId },
        select: { userId: true },
      });
      const prevMemberIdList = prevMemberList.map((member) => member.userId);
      for await (const userId of memberIdList) {
        if (!memberIdList.includes(userId)) {
          await manager.delete(UserFeedMapping, { userId });
        }
      }

      for await (const userId of memberIdList) {
        if (!prevMemberIdList.includes(userId)) {
          await manager.save(UserFeedMapping, { feedId, userId });
        }
      }
      await this.cacheManager.set(`${feedId}`, createFeedDto);
    });
  }

  async getGroupFeedList(userId: number) {
    // const subQuery = await this.dataSource
    //   .createQueryBuilder()
    //   .select('feedId')
    //   .from(UserFeedMapping, 'user_feed_mapping')
    //   .where('user_feed_mapping.feedId = feeds.id')
    //   .andWhere('user_feed_mapping.userId = :userId', { userId });

    // const feedList = await this.dataSource
    //   .createQueryBuilder()
    //   .select(['id AS feed_id', 'name AS feed_name', 'thumbnail'])
    //   .from(Feed, 'feeds')
    //   .where(`EXISTS (${subQuery.getQuery()})`)
    //   .andWhere('isGroupFeed = :isGroupFeed', { isGroupFeed: true })
    //   .setParameters(subQuery.getParameters())
    //   .execute();
    const feedList = await this.feedRepository2.getFeedList(userId, true);
    if (!feedList) throw new NonExistFeedError();
    return FeedResponseDto.makeFeedResponseArray(feedList);
  }

  async getPersonalFeedList(userId: number) {
    const feedList = await this.feedRepository2.getFeedList(userId, false);
    if (!feedList) throw new NonExistFeedError();
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
