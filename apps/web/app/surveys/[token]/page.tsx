import { PublicSurveyForm } from '@/components/survey/live/public-survey-form';
export default function Page({params}:{params:{token:string}}){return <PublicSurveyForm token={params.token}/>;}
