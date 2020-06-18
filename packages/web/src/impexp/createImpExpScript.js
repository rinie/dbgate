import _ from 'lodash';
import ScriptWriter from './ScriptWriter';
import getAsArray from '../utility/getAsArray';
import { getConnectionInfo } from '../utility/metadataLoaders';
import engines from '@dbgate/engines';
import { findObjectLike } from '@dbgate/datalib';
import { quoteFullName, fullNameFromString } from '@dbgate/datalib';

export function getTargetName(source, values) {
  const key = `targetName_${source}`;
  if (values[key]) return values[key];
  if (values.targetStorageType == 'csv') return `${source}.csv`;
  if (values.targetStorageType == 'jsonl') return `${source}.jsonl`;
  return source;
}

async function getConnection(storageType, conid, database) {
  if (storageType == 'database') {
    const conn = await getConnectionInfo({ conid });
    const driver = engines(conn);
    return [
      {
        ..._.pick(conn, ['server', 'engine', 'user', 'password', 'port']),
        database,
      },
      driver,
    ];
  }
  return [null, null];
}

function getSourceExpr(sourceName, values, sourceConnection, sourceDriver) {
  if (values.sourceStorageType == 'database') {
    const fullName = { schemaName: values.sourceSchemaName, pureName: sourceName };
    return [
      'queryReader',
      {
        connection: sourceConnection,
        // @ts-ignore
        sql: `select * from ${quoteFullName(sourceDriver.dialect, fullName)}`,
      },
    ];
  }
}

function getFlagsFroAction(action) {
  switch (action) {
    case 'dropCreateTable':
      return {
        createIfNotExists: true,
        dropIfExists: true,
      };
    case 'truncate':
      return {
        createIfNotExists: true,
        truncate: true,
      };
  }

  return {
    createIfNotExists: true,
  };
}

function getTargetExpr(sourceName, values, targetConnection, targetDriver) {
  if (values.targetStorageType == 'csv') {
    return [
      'csvWriter',
      {
        fileName: getTargetName(sourceName, values),
      },
    ];
  }
  if (values.targetStorageType == 'jsonl') {
    return [
      'jsonLinesWriter',
      {
        fileName: getTargetName(sourceName, values),
      },
    ];
  }
  if (values.targetStorageType == 'database') {
    return [
      'tableWriter',
      {
        connection: targetConnection,
        schemaName: values.targetSchemaName,
        pureName: getTargetName(sourceName, values),
        ...getFlagsFroAction(values[`actionType_${sourceName}`]),
      },
    ];
  }
}

export default async function createImpExpScript(values) {
  const script = new ScriptWriter();

  const [sourceConnection, sourceDriver] = await getConnection(
    values.sourceStorageType,
    values.sourceConnectionId,
    values.sourceDatabaseName
  );
  const [targetConnection, targetDriver] = await getConnection(
    values.targetStorageType,
    values.targetConnectionId,
    values.targetDatabaseName
  );

  if (values.sourceStorageType == 'database') {
    const sourceList = getAsArray(values.sourceList);
    for (const sourceName of sourceList) {
      const sourceVar = script.allocVariable();
      // @ts-ignore
      script.assign(sourceVar, ...getSourceExpr(sourceName, values, sourceConnection, sourceDriver));

      const targetVar = script.allocVariable();
      // @ts-ignore
      script.assign(targetVar, ...getTargetExpr(sourceName, values, targetConnection, targetDriver));

      script.copyStream(sourceVar, targetVar);
      script.put();
    }
  }
  return script.s;
}

export function getActionOptions(source, values, targetDbinfo) {
  const res = [];
  const targetName = getTargetName(source, values);
  if (values.targetStorageType == 'database') {
    let existing = findObjectLike(
      { schemaName: values.targetSchemaName, pureName: targetName },
      targetDbinfo,
      'tables'
    );
    if (existing) {
      res.push({
        label: 'Append data',
        value: 'appendData',
      });
      res.push({
        label: 'Truncate and import',
        value: 'truncate',
      });
      res.push({
        label: 'Drop and create table',
        value: 'dropCreateTable',
      });
    } else {
      res.push({
        label: 'Create table',
        value: 'createTable',
      });
    }
  } else {
    res.push({
      label: 'Create file',
      value: 'createFile',
    });
  }
  return res;
}
