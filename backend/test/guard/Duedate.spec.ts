import { createMock } from '@golevelup/ts-jest';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import FindPostingDto from '@posting/dto/find.posting.dto';

import {
  AccessAfterDueDateException,
  AccessBeforeDueDateException,
} from '@root/custom/customError/httpException';
import { DueDateGuard } from '@common/guard/DueDate.guard';
import { PostingService } from '@root/posting/posting.service';
import { ServerErrorHandlingFilter } from '@root/common/filters/ServerErrorHandlingFilter';
import { HttpExceptionFilter } from '@root/common/filters/http-exception.filter';
import { FeedService } from '@root/feed/feed.service';
import configuration from '../../configuration';

describe('공개일 접근 가드(DueDateGuard) 동작 unit test', () => {
  let app: INestApplication;
  let dueDateGuard: DueDateGuard;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: `${process.cwd()}/config/.${process.env.NODE_ENV}.env`,
          load: [configuration],
        }),
      ],
      providers: [DueDateGuard],
    })
      .useMocker((token) => {
        const today = new Date();
        const yesterday = new Date(today.setDate(today.getDate() - 1));
        const tomorrow = new Date(today.setDate(today.getDate() + 2));

        if (token === PostingService)
          return {
            getPosting: (
              findPostingDto: FindPostingDto & Record<string, unknown>,
            ) => {
              if (findPostingDto.id === 1)
                return [{ feed: { dueDate: yesterday } }];
              return [{ feed: { dueDate: tomorrow } }];
            },
          };
        if (token === FeedService)
          return {
            getFeedById: (feedId: number) => {
              if (feedId === 1) return { dueDate: yesterday };
              return { dueDate: tomorrow };
            },
          };
        return null;
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(
      new ServerErrorHandlingFilter(),
      new HttpExceptionFilter(),
    );
    dueDateGuard = moduleFixture.get(DueDateGuard);
    await app.init();
  });

  describe('포스팅 생성 api', () => {
    it('피드 공개일 전 접근 가능', async () => {
      const mockContext = createMock<ExecutionContext>();
      const req = mockContext.switchToHttp().getRequest();
      const mockParam = { feedId: 2 };
      const mockRoute = { path: '/posting/:feedId', methods: { post: true } };

      Object.assign(req, { route: mockRoute });
      Object.assign(req, { params: mockParam });

      console.log(dueDateGuard.canActivate(mockContext));
      expect(dueDateGuard.canActivate(mockContext)).resolves.toBe(true);
    });

    it('피드 공개일 이후 접근 불가(AccessAfterDueDateException)', async () => {
      const mockContext = createMock<ExecutionContext>();
      const req = mockContext.switchToHttp().getRequest();
      const mockParam = { feedId: 1 };
      const mockRoute = { path: '/posting/:feedId', methods: { post: true } };

      Object.assign(req, { route: mockRoute });
      Object.assign(req, { params: mockParam });

      expect(dueDateGuard.canActivate(mockContext)).rejects.toThrowError(
        new AccessAfterDueDateException(),
      );
    });
  });

  describe('나머지 api', () => {
    it('피드 공개일 후 접근 가능', async () => {
      const mockContext = createMock<ExecutionContext>();
      const req = mockContext.switchToHttp().getRequest();
      const mockParam = { postingId: 1 };

      Object.assign(req, { params: mockParam });

      expect(dueDateGuard.canActivate(mockContext)).resolves.toBe(true);
    });

    it('피드 공개일 전 접근 불가(AccessBeforeDueDateException)', async () => {
      const mockContext = createMock<ExecutionContext>();
      const req = mockContext.switchToHttp().getRequest();
      const mockParam = { postingId: 2 };

      Object.assign(req, { params: mockParam });

      expect(dueDateGuard.canActivate(mockContext)).rejects.toThrowError(
        new AccessBeforeDueDateException(),
      );
    });
  });
});
