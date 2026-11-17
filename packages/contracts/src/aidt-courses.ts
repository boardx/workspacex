/** User-approved FR01 course registry. Course metadata never grants Project membership. */
import { z } from "zod";
import { ProjectListItem } from "./project";
const identifier=z.string().min(1).max(200);
export const Course=z.object({id:identifier,name:z.string().trim().min(1).max(120),createdAt:z.string().datetime()}).strict();
export const CourseGroup=z.object({project:ProjectListItem,members:z.array(z.object({userId:identifier,displayName:z.string()}).strict())}).strict();
export const Page=z.object({cursor:identifier.optional(),limit:z.number().int().min(1).max(50).default(20)}).strict();
export const CourseError=z.enum(["AIDT_COURSE_NOT_FOUND","AIDT_COURSE_FORBIDDEN","AIDT_COURSE_GROUP_CONFLICT","AIDT_COURSE_OPERATION_CONFLICT","AIDT_COURSE_INVALID","AIDT_COURSE_UNAVAILABLE"]);
export const operations={
 list:{method:"GET",path:"/aidt/courses",in:Page,out:z.object({items:z.array(Course),nextCursor:identifier.nullable()}).strict(),err:CourseError},
 create:{method:"POST",path:"/aidt/courses",in:z.object({name:Course.shape.name,operationId:z.string().uuid()}).strict(),out:z.object({course:Course,replayed:z.boolean()}).strict(),err:CourseError},
 groups:{method:"GET",path:"/aidt/courses/:courseId/groups",in:Page.extend({courseId:identifier}).strict(),out:z.object({course:Course,items:z.array(CourseGroup),nextCursor:identifier.nullable()}).strict(),err:CourseError},
 link:{method:"PUT",path:"/aidt/courses/:courseId/groups/:projectId",in:z.object({courseId:identifier,projectId:identifier}).strict(),out:z.object({courseId:identifier,projectId:identifier,replayed:z.boolean()}).strict(),err:CourseError},
} as const;
export type CourseValue=z.infer<typeof Course>;
export type CourseGroupValue=z.infer<typeof CourseGroup>;
export type CoursePage=z.infer<typeof Page>;
export type CreateCourseInput=z.infer<typeof operations.create.in>;
