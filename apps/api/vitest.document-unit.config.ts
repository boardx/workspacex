import {defineConfig} from 'vitest/config';

// Document parser tests are pure service/adapter tests and do not touch PostgreSQL.
// Keeping this lane explicit lets constrained builders run them without weakening the
// canonical database isolation setup used by the rest of the API suite.
export default defineConfig({
  test:{
    include:[
      'tests/agent-runtime/standard-document-tools.test.ts',
      'tests/agent-runtime/chat-skill-script-execution.test.ts',
      'tests/chat/anydoc-attachment-to-markdown.test.ts',
    ],
    environment:'node',
  },
});
