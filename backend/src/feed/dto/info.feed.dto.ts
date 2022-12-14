import { PickType } from '@nestjs/swagger';
import { NonExistFeedError } from '@root/custom/customError/serverError';
import { Feed } from '@root/entities/Feed.entity';
import UserFeedMapping from '@root/entities/UserFeedMapping.entity';

export default class FeedInfoDto extends PickType(Feed, [
  'name',
  'thumbnail',
  'description',
  'dueDate',
  'isGroupFeed',
] as const) {
  postingCnt: number;

  isOwner: boolean;

  constructor(feed: Feed, user: UserFeedMapping) {
    super();
    this.name = feed.name;
    this.thumbnail = feed.thumbnail;
    this.description = feed.description;
    this.dueDate = feed.dueDate;
    this.isGroupFeed = feed.isGroupFeed;
    this.getPostingCnt(feed.postings);
    this.checkIsOwner(user);
  }

  getPostingCnt(postingArray: { id: number }[]) {
    this.postingCnt = postingArray.length;
  }

  checkIsOwner(user: UserFeedMapping) {
    if (!user) this.isOwner = false;
    else this.isOwner = true;
  }

  static createFeedInfoDto(feed: Feed, user: UserFeedMapping) {
    if (!feed) throw new NonExistFeedError();
    return new FeedInfoDto(feed, user);
  }
}
