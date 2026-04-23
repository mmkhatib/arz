/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cedar: {
          50:  "#f0f7f4",
          100: "#d9ede5",
          200: "#b5dbcc",
          300: "#85c1ab",
          400: "#55a086",
          500: "#2d6a4f",  // cedar green
          600: "#245840",
          700: "#1d4633",
          800: "#173728",
          900: "#112b1f",
          950: "#0a1a13",
        },
      },
    },
  },
  plugins: [],
};
