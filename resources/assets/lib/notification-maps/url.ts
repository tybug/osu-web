// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the GNU Affero General Public License v3.0.
// See the LICENCE file in the repository root for full licence text.

import { route } from 'laroute';
import Notification from 'models/notification';

export function urlGroup(item: Notification) {
  if (item.name === 'comment_new') {
    switch (item.objectType) {
      case 'beatmapset':
        return route('beatmapsets.show', { beatmapset: item.objectId });
      case 'build':
        return route('changelog.show', { changelog: item.objectId, key: 'id' });
      case 'news_post':
        return route('news.show', { news: item.objectId, key: 'id' });
    }
  } else if (item.name === 'user_achievement_unlock') {
    return userAchievementUrl(item);
  }

  switch (item.objectType) {
    case 'beatmapset':
      return route('beatmapsets.discussion', { beatmapset: item.objectId });
    case 'channel':
      return route('chat.index', { sendto: item.sourceUserId });
    case 'forum_topic':
      return route('forum.topics.show', { topic: item.objectId, start: 'unread' });
  }
}

export function urlSingular(item: Notification) {
  switch (item.name) {
    case 'beatmapset_discussion_lock':
    case 'beatmapset_discussion_unlock':
    case 'beatmapset_disqualify':
    case 'beatmapset_love':
    case 'beatmapset_nominate':
    case 'beatmapset_qualify':
    case 'beatmapset_remove_from_loved':
    case 'beatmapset_reset_nominations':
      return route('beatmapsets.discussion', { beatmapset: item.objectId });
    case 'beatmapset_discussion_post_new':
    case 'beatmapset_discussion_qualified_problem':
    case 'beatmapset_discussion_review_new':
      return BeatmapDiscussionHelper.url({
        beatmapId: item.details.beatmapId,
        beatmapsetId: item.objectId,
        discussionId: item.details.discussionId,
      });
    case 'beatmapset_rank':
      return route('beatmapsets.show', { beatmapset: item.objectId });
    case 'channel_message':
      return route('chat.index', { sendto: item.sourceUserId });
    case 'comment_new':
    case 'comment_reply':
      return route('comments.show', { comment: item.details.commentId });
    case 'forum_topic_reply':
      return route('forum.posts.show', { post: item.details.postId });
    case 'user_achievement_unlock':
      return userAchievementUrl(item);
  }
}

function userAchievementUrl(item: Notification) {
  const params = {
    mode: item.details.achievementMode ?? undefined,
    user: item.details.userId,
  };

  return `${route('users.show', params)}#medals`;
}
