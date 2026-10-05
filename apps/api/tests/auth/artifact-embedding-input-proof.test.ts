import {it,expect} from 'vitest';
import {artifactEmbeddingInputHash,artifactEmbeddingInputMatchesSource as proves} from '../../src/application/retrieval/artifact-embedding-input-proof';
it('matches each entire actual source text including repeated batches, without accepting arbitrary query text',()=>{
 const hashes=['one','two'].map(artifactEmbeddingInputHash);
 expect(proves(JSON.stringify({model:'actual',input:['one','two','one'],encoding_format:'base64'}),hashes)).toBe(true);
 expect(proves(JSON.stringify({model:'actual',input:'one'}),hashes)).toBe(true);
 for(const input of [['foreign'],['one','foreign'],[[23,45]],[],[''],['one plus secret']])expect(proves(JSON.stringify({model:'actual',input}),hashes)).toBe(false);
 expect(proves(JSON.stringify({model:'actual',input:['one']}),[])).toBe(false);
});
it('unclassified fields, noncanonical bytes and duplicate keys cannot piggyback confidential content',()=>{
 const hashes=[artifactEmbeddingInputHash('one')];
 for(const body of [JSON.stringify({model:'actual',input:['one'],private:'secret'}),'{"model":"actual", "input":["one"]}','{"model":"actual","input":["secret"],"input":["one"]}',JSON.stringify({model:'actual',input:['one'],dimensions:-1}),JSON.stringify({model:'actual',input:['one'],encoding_format:'private-secret'})])expect(proves(body,hashes)).toBe(false);
});
