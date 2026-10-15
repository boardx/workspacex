import type { Provider } from "@nestjs/common";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type IdentityRepository, type DecisionIdFactory } from "../../application/identity/ports";
import { CHAT_ATTACHMENT_COMMAND_REPOSITORY, type AttachmentCommandRepository } from "../../application/chat/upload-attachment";
import { OBJECT_STORE, type ObjectStore } from "../../application/artifact/ports";
import { CHAT_MESSAGE_COMMAND_REPOSITORY, type ChatMessageCommandRepository } from "../../application/chat/message-command-ports";
import { CHAT_SHARE_SERVICE, ChatShareService } from "../../application/chat/share-chat";
import { PgChatShareRepository } from "./pg-chat-share-repository";

/** Feature composition stays outside the already large kernel module. */
export const CHAT_SHARE_PROVIDERS: Provider[] = [{
  provide: CHAT_SHARE_SERVICE,
  useFactory: (db: DatabasePort, chat: ChatRepository, repo: IdentityRepository,
    ids: DecisionIdFactory, attachments: AttachmentCommandRepository, store: ObjectStore,
    commands: ChatMessageCommandRepository) => new ChatShareService({
      chat, repo, ids, attachments, store, commands, shares: new PgChatShareRepository(db),
    }),
  inject: [DATABASE_PORT, CHAT_REPOSITORY, IDENTITY_REPOSITORY, DECISION_ID_FACTORY,
    CHAT_ATTACHMENT_COMMAND_REPOSITORY, OBJECT_STORE, CHAT_MESSAGE_COMMAND_REPOSITORY],
}];
