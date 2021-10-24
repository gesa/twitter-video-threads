import { FullUser, User } from "twitter-d/types/user";

export function isFullUser(user: User): user is FullUser {
  return "screen_name" in user;
}

export function calculateHDVideo(size = { w: 0, h: 0 }): number {
  const largerSide = size.w > size.h ? size.w : size.h;

  if (largerSide > 1080) {
    return 3;
  }

  if (largerSide > 720) {
    return 2;
  }

  if (largerSide > 480) {
    return 1;
  }

  return 0;
}
