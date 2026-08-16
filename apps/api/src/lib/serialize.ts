import type { Comment, Notification, Post, User } from '@prisma/client';

/**
 * One place that decides what leaves the API. Keeps `passwordHash` and email
 * from ever slipping into a response because someone returned a raw row.
 */
export type PublicUser = ReturnType<typeof toPublicUser>;

export function toPublicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    postCount: user.postCount,
    isCelebrity: user.isCelebrity,
    createdAt: user.createdAt.toISOString(),
  };
}

/** The signed-in user's own record, which may include private fields. */
export function toPrivateUser(user: User) {
  return { ...toPublicUser(user), email: user.email };
}

export type PostDto = ReturnType<typeof toPostDto>;

export function toPostDto(
  post: Post & { author: User },
  options: { likedByViewer?: boolean; score?: number } = {},
) {
  return {
    id: post.id,
    content: post.content,
    mediaUrls: post.mediaUrls ?? null,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    createdAt: post.createdAt.toISOString(),
    author: toPublicUser(post.author),
    likedByViewer: options.likedByViewer ?? false,
    // Present on feed responses so you can see the ranking working in the UI.
    score: options.score,
  };
}

export type NotificationWithActor = Notification & { actor: User };

export function toNotificationDto(notification: NotificationWithActor) {
  return {
    id: notification.id,
    type: notification.type,
    postId: notification.postId,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
    actor: toPublicUser(notification.actor),
  };
}

/** Trimmed payload for the socket event - the client only renders a line of text. */
export function toNotificationEvent(notification: NotificationWithActor) {
  return {
    id: notification.id,
    type: notification.type,
    postId: notification.postId,
    createdAt: notification.createdAt.toISOString(),
    actor: {
      username: notification.actor.username,
      displayName: notification.actor.displayName,
    },
  };
}

export function toCommentDto(comment: Comment & { author: User }) {
  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    author: toPublicUser(comment.author),
  };
}
