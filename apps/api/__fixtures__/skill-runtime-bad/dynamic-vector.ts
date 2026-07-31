/**
 * 反证 fixture（**故意违规**）。
 *
 * 动态 import 的向量库客户端 —— 只认静态 `import … from` 的门控会放它过去，
 * 而它和静态写法在运行时是同一件事。
 */
export async function recall(query: string) {
  const { PineconeClient } = await import("@pinecone-database/pinecone");
  return new PineconeClient().query(query);
}
