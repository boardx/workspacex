import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
export function SurveySuccessMarkdown({markdown}:{markdown:string}) {
  return <div className="chat-markdown space-y-3"><ReactMarkdown skipHtml rehypePlugins={[rehypeSanitize]}>{markdown}</ReactMarkdown></div>;
}
