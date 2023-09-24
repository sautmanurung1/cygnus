import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const teamRouter = createTRPCRouter({
  getProfile: publicProcedure.query(({ ctx }) => {
    return ctx.prisma.user.findUnique({
      where: {
        id: ctx.session?.user.id,
      },
    });
  }),
});
