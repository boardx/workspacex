import {IDBFactory} from 'fake-indexeddb';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {SESSION_TOKEN_STORAGE_KEY} from '@/lib/api-client';
import {fingerprintWhiteboardSession,IndexedDbWhiteboardOutbox,WHITEBOARD_OUTBOX_STORAGE,type PendingWhiteboardUpdate,type WhiteboardOutboxScope} from '@/lib/whiteboard-outbox';

const {resolveIdentity}=vi.hoisted(()=>({resolveIdentity:vi.fn()}));
vi.mock('@/lib/session-api',()=>({resolveIdentity,switchCurrentOrganization:vi.fn()}));

import {SessionProvider,useSession} from '@/components/session/session-provider';

const login={sessionToken:'logout-receipt-token',userId:'logout-receipt-user',orgs:['org-one'],expiresAt:'2099-01-01T00:00:00.000Z'};
const identity={org:{id:'org-one',name:'One',kind:'organization',team:null,modelPolicy:'any'},orgRole:'lead',teamId:null,projectRole:null,groupId:null,displayName:'Ada'};

function Probe(){const session=useSession();return <><output data-testid="status">{session.status}</output><button data-testid="login" onClick={()=>void session.startSession(login)}>login</button><button data-testid="logout" onClick={session.logout}>logout</button></>;}

async function rows(storeName:string):Promise<Record<string,unknown>[]>{
  const opened=indexedDB.open(WHITEBOARD_OUTBOX_STORAGE.database,WHITEBOARD_OUTBOX_STORAGE.version);
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);opened.onerror=()=>reject(opened.error);});
  try{
    const request=database.transaction(storeName,'readonly').objectStore(storeName).getAll();
    return await new Promise<Record<string,unknown>[]>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result as Record<string,unknown>[]);request.onerror=()=>reject(request.error);});
  }finally{database.close();}
}

beforeEach(()=>{
  vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear();vi.stubGlobal('indexedDB',new IDBFactory());
  resolveIdentity.mockResolvedValue(identity);
});

it('clears auth synchronously and leaves a keyless quarantine receipt in real IndexedDB',async()=>{
  render(<SessionProvider><Probe/></SessionProvider>);
  await screen.findByText('anonymous');fireEvent.click(screen.getByTestId('login'));
  await waitFor(()=>expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
  const sessionId=await fingerprintWhiteboardSession(login.sessionToken);
  const scope:WhiteboardOutboxScope={boardId:'11111111-1111-4111-8111-111111111111',orgId:'org-one',principalId:login.userId,sessionId,epoch:1,accessReceiptId:'22222222-2222-4222-8222-222222222222'};
  const update:PendingWhiteboardUpdate={type:'update',epoch:1,updateId:'33333333-3333-4333-8333-333333333333',update:'AQID'};
  const outbox=new IndexedDbWhiteboardOutbox();await outbox.put(scope,update);

  fireEvent.click(screen.getByTestId('logout'));
  expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  await waitFor(()=>expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  await waitFor(async()=>expect(await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore)).toHaveLength(0));
  const stored=await rows(WHITEBOARD_OUTBOX_STORAGE.quarantineStore);
  expect(stored).toEqual([expect.objectContaining({boardId:scope.boardId,sessionId,pendingCount:1,reason:'SESSION_CHANGED',accessReceiptId:scope.accessReceiptId})]);
  expect(stored[0]).not.toHaveProperty('key');
  expect(stored[0]).toHaveProperty('ciphertext',[expect.objectContaining({updateId:update.updateId})]);
});
