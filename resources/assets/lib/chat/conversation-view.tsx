// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the GNU Affero General Public License v3.0.
// See the LICENCE file in the repository root for full licence text.

import { ChatChannelLoadEarlierMessages } from 'actions/chat-actions';
import { dispatch, dispatchListener } from 'app-dispatcher';
import { route } from 'laroute';
import * as _ from 'lodash';
import { computed } from 'mobx';
import { inject, observer } from 'mobx-react';
import Message from 'models/chat/message';
import * as moment from 'moment';
import * as React from 'react';
import { ShowMoreLink } from 'show-more-link';
import { Spinner } from 'spinner';
import RootDataStore from 'stores/root-data-store';
import { StringWithComponent } from 'string-with-component';
import { UserAvatar } from 'user-avatar';
import { ChatChannelSwitchAction } from '../actions/chat-actions';
import DispatcherAction from '../actions/dispatcher-action';
import DispatchListener from '../dispatch-listener';
import { MessageDivider } from './message-divider';
import MessageGroup from './message-group';

interface Props {
  dataStore?: RootDataStore;
}

interface Snapshot {
  chatHeight: number;
  chatTop: number;
}

const blankSnapshot = (): Snapshot => ({ chatHeight: 0, chatTop: 0 });

@inject('dataStore')
@observer
@dispatchListener
export default class ConversationView extends React.Component<Props> implements DispatchListener {
  private assumeHasBacklog: boolean = false;
  private chatViewRef = React.createRef<HTMLDivElement>();
  private readonly dataStore: RootDataStore;
  private didSwitchChannel: boolean = true;
  private firstMessage?: Message;
  private unreadMarkerRef = React.createRef<HTMLDivElement>();

  @computed
  get currentChannel() {
    return this.dataStore.channelStore.channels.get(this.dataStore.uiState.chat.selected);
  }

  constructor(props: Props) {
    super(props);

    this.dataStore = props.dataStore!;
  }

  componentDidMount() {
    this.componentDidUpdate();
    $(window).on('throttled-scroll', _.throttle(this.onScroll, 1000));
  }

  componentDidUpdate = (prevProps?: Props, prevState?: {}, snapshot?: Snapshot) => {
    const chatView = this.chatViewRef.current;
    if (!chatView) {
      return;
    }

    const dataStore = this.dataStore;
    const channel = dataStore.channelStore.channels.get(dataStore.uiState.chat.selected);
    if (!channel?.loaded) {
      return;
    }

    if (this.didSwitchChannel) {
      if (this.unreadMarkerRef.current) {
        this.scrollToUnread();
      } else {
        this.scrollToBottom();
      }
      this.didSwitchChannel = false;
    } else {
      snapshot = snapshot ?? blankSnapshot();
      const prepending = this.firstMessage !== this.currentChannel?.messages[0];

      if (prepending && this.chatViewRef.current != null) {
        const chatEl = this.chatViewRef.current;
        const newHeight = chatEl.scrollHeight;
        chatEl.scrollTo(chatEl.scrollLeft, snapshot.chatTop + (newHeight - snapshot.chatHeight));
      } else {
        if (this.dataStore.uiState.chat.autoScroll) {
          this.scrollToBottom();
        }
      }
    }

    this.firstMessage = channel.messages[0];
  }

  getSnapshotBeforeUpdate() {
    const snapshot = blankSnapshot();

    if (this.chatViewRef.current != null) {
      snapshot.chatHeight = this.chatViewRef.current.scrollHeight;
      snapshot.chatTop = this.chatViewRef.current.scrollTop;
    }

    return snapshot;
  }

  handleDispatchAction(action: DispatcherAction) {
    if (action instanceof ChatChannelSwitchAction) {
      this.didSwitchChannel = true;
    }
  }

  noCanSendMessage(): React.ReactNode {
    const channel = this.currentChannel;

    if (channel == null) {
      // this shouldn't happen...
      return;
    }

    if (channel.type === 'PM' || channel.type === 'NEW') {
      return (
        <div>
          <div className='chat-conversation__cannot-message'>{osu.trans('chat.cannot_send.user')}</div>
          <ul className='chat-conversation__cannot-message-reasons'>
            <li>{osu.trans('chat.cannot_send.reasons.friends_only')}</li>
            <li>{osu.trans('chat.cannot_send.reasons.target_restricted')}</li>
            <li>{osu.trans('chat.cannot_send.reasons.restricted')}</li>
            <li>{osu.trans('chat.cannot_send.reasons.blocked')}</li>
          </ul>
        </div>
      );
    } else if (channel.type === 'GROUP') {
      return (
        <div>
          <div className='chat-conversation__cannot-message'>{osu.trans('chat.cannot_send.channel')}</div>
          <ul className='chat-conversation__cannot-message-reasons'>
            <li>{osu.trans('chat.cannot_send.reasons.channel_moderated')}</li>
            <li>{osu.trans('chat.cannot_send.reasons.restricted')}</li>
          </ul>
        </div>
      );
    }
  }

  onScroll = () => {
    const chatView = this.chatViewRef.current;
    if (chatView) {
      this.dataStore.uiState.chat.autoScroll = chatView.scrollTop + chatView.clientHeight >= chatView.scrollHeight;
    }
  }

  render(): React.ReactNode {
    const channel = this.currentChannel;
    this.assumeHasBacklog = false;

    if (channel == null) {
      return <div className='conversation' />;
    }

    const conversationStack: JSX.Element[] = [];
    let currentGroup: Message[] = [];
    let unreadMarkerShown = false;
    let currentDay: number;

    _.each(channel.messages, (message: Message, key: number) => {
      // check if the last read indicator needs to be shown
      if (!unreadMarkerShown && message.messageId > this.dataStore.uiState.chat.lastReadId && message.sender.id !== currentUser.id) {
        unreadMarkerShown = true;

        // If the unread marker is the first element in this conversation, it most likely means that the unread cursor
        // is even further in the past, making the displayed marker somewhat useless (until we can back-load those
        // past messages in)... thus we ignore it when auto-scrolling and just go to the bottom instead.
        //
        // TODO: Actually in hindsight, there's another scenario where the first element in the conversation is an
        // unread marker - when you receive new PMs and have yet to read any. Will look to handle this case later...
        if (_.isEmpty(conversationStack)) {
          this.assumeHasBacklog = true;
        }

        if (!_.isEmpty(currentGroup)) {
          conversationStack.push(<MessageGroup key={currentGroup[0].uuid} messages={currentGroup} />);
          currentGroup = [];
        }
        conversationStack.push(<MessageDivider key={`read-${message.timestamp}`} ref={this.unreadMarkerRef} type='UNREAD_MARKER' timestamp={message.timestamp} />);
      }

      // check whether the day-change header needs to be shown
      if (_.isEmpty(conversationStack) || moment(message.timestamp).date() !== currentDay /* TODO: make check less dodgy */) {
        if (!_.isEmpty(currentGroup)) {
          conversationStack.push(<MessageGroup key={currentGroup[0].uuid} messages={currentGroup} />);
          currentGroup = [];
        }
        conversationStack.push(<MessageDivider key={`day-${message.timestamp}`} type='DAY_MARKER' timestamp={message.timestamp} />);
        currentDay = moment(message.timestamp).date();
      }

      // add message to current message grouping if the sender is the same, otherwise create a new message grouping
      const lastCurrentGroup = _.last(currentGroup);
      if (lastCurrentGroup == null || lastCurrentGroup.sender.id === message.sender.id) {
        currentGroup.push(message);
      } else {
        conversationStack.push(<MessageGroup key={currentGroup[0].uuid} messages={currentGroup} />);
        currentGroup = [];
        currentGroup.push(message);
      }

      if (key === channel.messages.length - 1) {
        conversationStack.push(<MessageGroup key={currentGroup[0].uuid} messages={currentGroup} />);
      }
    });

    return (
      <div className='chat-conversation' onScroll={this.onScroll} ref={this.chatViewRef}>
        <div className='chat-conversation__new-chat-avatar'>
          <UserAvatar user={{id: 0, avatar_url: channel.icon}} />
        </div>
        <div className='chat-conversation__chat-label'>
          {channel.type === 'PM' ? (
            <StringWithComponent
              pattern={osu.trans('chat.talking_with')}
              // TODO: rework this once the user class situation is resolved
              mappings={{':name': <a key='user' className='js-usercard' data-user-id={channel.pmTarget} href={route('users.show', {user: channel.pmTarget})}>{channel.name}</a>}}
            />
          ) : (
            osu.trans('chat.talking_in', {channel: channel.name})
          )}
        </div>
        {channel.description &&
          <div className='chat-conversation__chat-label'>
            {channel.description}
          </div>
        }
        {!channel.loading &&
          <ShowMoreLink
            callback={this.loadEarlierMessages}
            direction={'up'}
            hasMore={channel.hasEarlierMessages}
            loading={channel.loadingEarlierMessages}
            modifiers={['chat-conversation-earlier-messages']}
          />
        }
        {channel.loading &&
          <div className='chat-conversation__day-divider'>
            <Spinner />
          </div>
        }
        {conversationStack}
        {channel.moderated &&
          this.noCanSendMessage()
        }
      </div>
    );
  }

  scrollToBottom = (): void => {
    const chatView = this.chatViewRef.current;
    if (chatView) {
      $(chatView).scrollTop(chatView.scrollHeight);
    }
  }

  scrollToUnread = (): void => {
    const chatView = this.chatViewRef.current;
    if (chatView && this.unreadMarkerRef.current) {
      if (this.assumeHasBacklog) {
        this.scrollToBottom();
      } else {
        $(chatView).scrollTop(this.unreadMarkerRef.current.offsetTop);
      }
    }
  }

  private loadEarlierMessages = () => {
    if (this.currentChannel == null) return;
    dispatch(new ChatChannelLoadEarlierMessages(this.currentChannel.channelId));
  }
}
