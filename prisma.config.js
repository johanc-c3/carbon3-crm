module.exports = {
  schema: './prisma/schema.prisma', // Tells Prisma 7 exactly where to look
  datasource: {
    url: 'file:./dev.db'
  }
}