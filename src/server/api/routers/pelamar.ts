import { format } from "date-fns";
import { id } from "date-fns/locale";
const Sib = require("@getbrevo/brevo") as TBrevo;

import { env } from "~/env.mjs";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
import { filterPelamarSchema, createPelamarSchema, deletePelamarSchema, updatePelamarSchema, deleteAllPelamarSchema, createManyPelamarSchema } from "~/schema/pelamar";
import { sendMessage } from "~/schema/whatsApp";
import { sendEmail } from "~/schema/email";
import whatsApp from "~/server/whatsApp";
import { emailTemplate } from "~/components/EmailTemplate";

import type { TBrevo } from "~/types/brevo";

export const pelamarRouter = createTRPCRouter({
  getAll: publicProcedure.input(filterPelamarSchema).query(async ({ ctx, input }) => {
    const where = input;
    const pelamar = ctx.prisma.pelamar.findMany({
      take: where?.take,
      skip: where?.skip,
      where: {
        createdAt: where?.createdAt || undefined,
        userId: ctx.session?.user.id,
        hasWhatsapp: where?.hasWhatsapp === true ? true : undefined,
        invitedByWhatsapp: where?.invitedByWhatsapp === true ? true : undefined,
        invitedByEmail: where?.invitedByEmail === true ? true : undefined,
        name: {
          contains: where?.name,
          mode: "insensitive",
        },
      },
    });
    const count = ctx.prisma.pelamar.count({
      where: {
        createdAt: where?.createdAt || undefined,
        userId: ctx.session?.user.id,
        hasWhatsapp: where?.hasWhatsapp === true ? true : undefined,
        invitedByWhatsapp: where?.invitedByWhatsapp === true ? true : undefined,
        invitedByEmail: where?.invitedByEmail === true ? true : undefined,
        name: {
          contains: where?.name,
          mode: "insensitive",
        },
      },
    });

    return ctx.prisma.$transaction([pelamar, count]).then(([pelamar, count]) => {
      return {
        status: 200,
        message: "Berhasil mendapatkan data pelamar",
        result: {
          pelamar,
          count,
        },
      };
    });
  }),

  create: protectedProcedure.input(createPelamarSchema).mutation(async ({ input, ctx }) => {
    const { name, email, phone, position, interviewDate } = input;

    const result = await ctx.prisma.$transaction(async (prisma) => {
      const phoneExists = await prisma.pelamar.findFirst({
        where: { phone },
      });

      if (phoneExists) {
        return {
          status: 400,
          message: "Nomor telepon sudah terdaftar",
        };
      }

      const { onwhatsapp } = (await whatsApp.checkNumber(phone)) as {
        onwhatsapp: "true" | "false";
      };

      const createdPelamar = await prisma.pelamar.create({
        data: {
          name,
          email,
          phone,
          position,
          hasWhatsapp: onwhatsapp === "true",
          interviewDate,
          userId: ctx.session?.user.id,
        },
      });

      return {
        status: 201,
        message: "Berhasil menambahkan pelamar",
        result: createdPelamar,
      };
    });

    return result;
  }),

  createMany: protectedProcedure.input(createManyPelamarSchema).mutation(async ({ input, ctx }) => {
    return ctx.prisma.$transaction(async (prisma) => {
      const pelamars = input.map((pelamar) => {
        return {
          ...pelamar,
          userId: ctx.session?.user.id,
        };
      });

      const result = await prisma.pelamar.createMany({
        data: pelamars,
      });

      return {
        status: 201,
        message: "Berhasil menambahkan pelamar",
        result: result,
      };
    });
  }),

  update: protectedProcedure.input(updatePelamarSchema).mutation(async ({ input, ctx }) => {
    const { id, name, email, phone, position, interviewDate } = input;

    const phoneExists = await ctx.prisma.pelamar.findFirst({
      where: { phone },
    });

    if (phoneExists) {
      return {
        status: 400,
        message: "Nomor telepon sudah terdaftar",
      };
    }

    let haveWhatsapp = false;

    if (phone) {
      const { onwhatsapp } = (await whatsApp.checkNumber(phone)) as {
        onwhatsapp: "true" | "false";
      };
      haveWhatsapp = onwhatsapp === "true";
    }

    const result = await ctx.prisma.pelamar.update({
      where: {
        id,
      },
      data: {
        name,
        email,
        phone,
        hasWhatsapp: haveWhatsapp,
        position,
        interviewDate,
      },
    });

    return {
      status: 201,
      message: "Berhasil mengubah pelamar",
      result: result,
    };
  }),

  delete: protectedProcedure.input(deletePelamarSchema).mutation(async ({ input, ctx }) => {
    const { id } = input;

    const result = await ctx.prisma.pelamar.delete({
      where: {
        id,
      },
    });

    return {
      status: 200,
      message: "Berhasil menghapus pelamar",
      result: result,
    };
  }),

  deleteAll: protectedProcedure.input(deleteAllPelamarSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.prisma.pelamar.deleteMany({
      where: {
        id: {
          in: input,
        },
      },
    });

    return {
      status: 200,
      message: "Berhasil menghapus semua pelamar",
      result: result,
    };
  }),

  sendWhatsApp: protectedProcedure.input(sendMessage).mutation(async ({ input, ctx }) => {
    const { number } = input;

    try {
      await ctx.prisma.$transaction(async (prisma) => {
        const pelamar = await prisma.pelamar.findFirst({
          where: {
            phone: number,
          },
        });

        if (!pelamar) {
          return {
            status: 404,
            message: "Pelamar tidak ditemukan",
          };
        }

        const template = await prisma.user.findFirst({
          where: {
            id: ctx.session?.user.id,
          },
        });

        if (!template) {
          return {
            status: 404,
            message: "Template tidak ditemukan",
          };
        }

        const templateMessage = template.templateWhatsApp
          .replace(/{{namaPelamar}}/g, pelamar.name)
          .replace(/{{position}}/g, pelamar.position)
          .replace(/{{namaPengirim}}/g, ctx.session?.user.fullName)
          .replace(/{{interviewTime}}/g, format(pelamar.interviewDate, "hh:mm", { locale: id }))
          .replace(
            /{{interviewDate}}/g,
            format(pelamar.interviewDate, "EEEE, dd MMMM yyyy", {
              locale: id,
            }),
          );

        const { status } = (await whatsApp.sendMessage({
          number,
          message: templateMessage,
        })) as { status: string };

        if (status !== "sent") {
          return {
            status: 500,
            message: "Gagal mengirim pesan",
          };
        }

        await prisma.pelamar.update({
          where: {
            phone: number,
          },
          data: {
            invitedByWhatsapp: true,
          },
        });

        return {
          status: 200,
          message: "Berhasil mengirim pesan",
        };
      });
    } catch (error) {
      // Handle any errors that occur during the transaction
      console.error("Error in Prisma transaction:", error);
      return {
        status: 500,
        message: "Internal server error",
      };
    }

    return {
      status: 200,
      message: "Berhasil mengirim pesan",
    };
  }),

  sendEmail: protectedProcedure.input(sendEmail).mutation(async ({ ctx, input }) => {
    const brevo = Sib;
    const client = brevo.ApiClient.instance;
    const apiKey = client.authentications["api-key"];
    apiKey.apiKey = env.NEXT_PUBLIC_BREVO_API_KEY;
    const transEmailApi = new brevo.TransactionalEmailsApi();

    const templateEmail = await ctx.prisma.emailTemplate.findFirst({
      where: {
        userId: ctx.session?.user.id,
      },
    });

    if (!templateEmail) {
      return {
        status: 404,
        message: "Template tidak ditemukan",
      };
    }

    const sender = {
      email: templateEmail.senderEmail,
      name: templateEmail.sender,
    };

    const { email, namaPelamar, position, interviewDate } = input;

    const receivers = [{ email }];

    const htmlContent = emailTemplate
      .replace(/{{namaPelamar}}/g, namaPelamar)
      .replace(/{{position}}/g, position)
      .replace(/{{namaPengirim}}/g, ctx.session?.user.fullName)
      .replace(/{{whatsApp}}/g, ctx.session?.user.phone.replace(/(\d{4})(\d{4})(\d{4})/, "$1-$2-$3"))
      .replace(/{{jobPortal}}/g, templateEmail.jobPortal)
      .replace(/{{whatsAppUrl}}/g, `https://wa.me/+62${ctx.session?.user.phone.replace(/^0+/, "")}`)
      .replace(/{{interviewTime}}/g, format(interviewDate, "hh:mm", { locale: id }))
      .replace(
        /{{interviewDate}}/g,
        format(interviewDate, "EEEE, dd MMMM yyyy", {
          locale: id,
        }),
      );

    try {
      transEmailApi.sendTransacEmail({
        sender,
        to: receivers,
        subject: templateEmail.subject,
        htmlContent,
      });
    } catch (error) {
      console.log(error);
    }

    await ctx.prisma.pelamar.updateMany({
      where: {
        email,
      },
      data: {
        invitedByEmail: true,
      },
    });

    return {
      status: 200,
      message: "Berhasil mengirim email",
    };
  }),
});
