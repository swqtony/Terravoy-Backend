import { error } from '../utils/responses.js';

export default async function storageRoutes(app) {
  const notImplemented = async (_req, reply) =>
    error(
      reply,
      'NOT_IMPLEMENTED',
      'Storage/文件上传由 LeanCloud 负责，本地后端未实现（请改用 LeanCloud 或上游存储）',
      501
    );

  app.all('/storage/*', notImplemented);
  app.all('/functions/v1/storage/*', notImplemented);
}
